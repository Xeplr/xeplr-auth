# @xeplr/auth

**The sign-in service for xeplr apps.** Register, activate, log in, forgot / reset password, invites, and sessions made of a short-lived access token plus a refresh token — kept in Redis, with an optional sliding refresh that hands back a new token in the `X-New-Token` response header. It also owns the RBAC catalog — `roles`, `apis`, `uiPages`, `uiElements` and `menus`, each mapped to roles and each (except elements) with an `isPublic` flag — and records multi-tenant membership in `userTenantsMapping`, which `mtMembershipMiddleware` enforces. Data lives in PostgreSQL; sessions and the access cache live in Redis.

```
POST /auth/api/login   { email, password }
→ { accessToken, refreshToken, user, access: { roles, pages, apis, menus, menuItems, elements } }
```

## Install

```sh
npm i @xeplr/auth
```

Peer: `express ^4 || ^5`. Needs PostgreSQL (migration `0001` runs `CREATE EXTENSION pgcrypto`) and Redis.

> **`REDIS_PREFIX` is required.** Set one of your own, e.g. `REDIS_PREFIX=myapp:`. It may not be unset, and may not be the shared default `xeplr:` — [why](#redis_prefix-is-required). Apps upgrading from an earlier version must add it, or the service will not start.

## Two ways to run it

### As its own service: `xeplr-auth-server`

```json
"start-auth": "dotenv -e development.env -- xeplr-auth-server"
```

`bin/server.js` calls `boot()`. It reads `process.env` only and loads no `.env` file — the launcher provides the environment. `boot()`:

1. checks `REDIS_PREFIX` ([refuses](#redis_prefix-is-required) if missing or `xeplr:`);
2. checks Redis is reachable ([refuses](#startup) if not);
3. runs auth's own migrations, then the directories in `XEPLR_AUTH_MIGRATIONS`;
4. configures email from env and checks it can send (never fatal);
5. starts Express on `AUTH_PORT` (default `19001`) with `/auth/api` and `/auth/api/admin` mounted;
6. prints a [banner](#startup) of the effective configuration.

When run under a parent process (`process.send` exists), it sends `{ status: 'ready' }` once listening.

To register [hooks](#hooks), write your own boot file — hooks only fire in the process that does the work:

```js
var auth = require('@xeplr/auth')
auth.hooks.on('user', 'create', async function(userId) { /* … */ })
auth.boot()
```

### In your own process

```js
var auth = require('@xeplr/auth')

await auth.init({
  database: 'myapp_auth',                                  // or AUTH_DB_NAME, default 'auth'
  connection: process.env.XEPLR_DB_CONNECTION,             // encrypted string, or { host, port, user, password }
  jwt: { secret: process.env.AUTH_JWT_SECRET, accessTokenExpiresIn: '15m' },
  email: { provider: 'smtp', smtp: { /* … */ } }           // optional
})

app.use('/auth/api', auth.router({ resetBaseUrl: 'https://app.example.com' }))
app.use('/auth/api/admin', auth.adminRouter())
```

`init()` checks `REDIS_PREFIX` but does **not** check Redis, run migrations, or print the banner — run [`xeplr-auth-migrate`](#migrations) yourself. It binds the auth models as the **process-wide** default connection; a process with its own database should use `attach()` instead, which opens a secondary connection. Pass `jwt.accessTokenExpiresIn` to match `AUTH_ACCESS_TOKEN_TTL_MINUTES` — without `jwt` the token lifetime is `15m` while the session entry in Redis follows the env value.

To act on auth tables from another service (invite a user, assign roles) while auth itself runs standalone:

```js
var auth = require('@xeplr/auth').attach()           // AUTH_DB_NAME + the connection env
await auth.ready()
await auth.model('UserRolesMapping').query().insert({ /* … */ })
await auth.service.invite({ email, name, invitedBy, inviterName, appName })
```

## Exports

| export | |
|---|---|
| `boot()` | the standalone service, env-driven, as above; resolves to the `http.Server` |
| `start(config)` | `init(config)` + Express on `config.port` with both routers; no Redis check, no migrations, no banner |
| `init(config)` | connect and bind the models, configure JWT and email; checks `REDIS_PREFIX` |
| `attach()` | secondary connection to the auth database from another process: `{ ready, conn, model(name), service }` |
| `router(options)` | the `/auth/api` router; `options.resetBaseUrl` sets where reset links point |
| `adminRouter()` | the `/auth/api/admin` router |
| `authMiddleware` | Bearer token check against the Redis session; sets `req.user`; slides within tolerance |
| `accessMiddleware(options)` | per-API RBAC from the `apis` catalog — see [Access checks](#access-checks) |
| `requireRole(...names)` | 403 unless `req.user.roles` holds one of the names; use after `authMiddleware` |
| `mtMembershipMiddleware(options)` | 403 when a tenant header names a value the caller has no membership for |
| `authService` | `register`, `activate`, `invite`, `previewInvite`, `acceptInvite`, `login`, `forgotPassword`, `resetPassword`, profile, phone OTP, `changePassword`, `configureActivation`, `configureEmail` |
| `accessService` | `getUserAccess`, `userHasApiAccess`, `getApiRule`, `getPublicItems`, `clearUserAccess`, `clearAccessRules`, `clearAllAccess` |
| `sessionService` | `createSession`, `getSession`, `validateAccessToken`, `slideAccessToken`, `rotateSession`, `destroySession`, `destroyAllUserSessions` |
| `ticketService` | `issueTicket`, `consumeTicket` — single-use 30-second tickets for SSE / WebSocket |
| `authHelper` | `configure`, `hashPassword`, `comparePassword`, `generateAccessToken`, `verifyToken`, `decodeVerified`, `generateId`, … |
| `hooks` | `on(identifier, event, fn)`, `fire`, `setHooksEnabled` |
| `seedSuperAdmin(knex, { email, password, name? })` | insert-if-absent super admin user + role mapping, for apps seeding from JS |
| `configureWorkflowResume(fn)` | hand in `@xeplr-workflow/api`'s `resumeByKey`; activation with a `workflowKey` then resumes that workflow (best-effort) |
| `requiredEnv` | the env names this package needs, for an app's `env.required.js`; `requiredEnv.activationLinkVar` names the activation-link variable in use |
| `models` | Objection models: `User`, `Role`, `Api`, `UiPage`, `UiElement`, `Menu`, the five `*RolesMapping`, `UserTenantsMapping` |

## Environment

### Required

Everything in `requiredEnv`, plus a connection and an activation link.

| variable | default in code | meaning |
|---|---|---|
| `REDIS_PREFIX` | — (refused) | namespace for every auth key in Redis; not `xeplr:` — [why](#redis_prefix-is-required) |
| `ENCRYPTION_KEY` | — | decrypts the connection string |
| `XEPLR_DB_CONNECTION` or `AUTH_DB_CONNECTION_INFO_ENCRYPTED` | — | encrypted `{ host, port, user, password }`. The shared `XEPLR_DB_CONNECTION` is used unless `AUTH_DB_CONNECTION_INFO_ENCRYPTED` overrides it for this service. Not in `requiredEnv`, since either one is correct |
| `AUTH_DB_NAME` | `auth` | the auth database — the server comes from the connection, the database from here |
| `AUTH_JWT_SECRET` | `change_me_in_production` | signs access tokens; the banner shows `✗ INSECURE DEFAULT` when unset |
| `AUTH_PORT` | `19001` | port for `boot()` / `start()` |
| `AUTH_SUPER_ADMIN_EMAIL` | — | the first account, used by migration `0008` — [details](#the-first-account) |
| `AUTH_SUPER_ADMIN_PASSWORD` | — | its password; no quotes, spaces, `$` or `#` (substituted into SQL) |
| `XEPLR_AUTH_MIGRATIONS` | none | comma-separated app migration directories, run after auth's own — [details](#migrations) |
| `AUTH_ACTIVATION_URL` | — | full address of your activation page, e.g. `http://localhost:19100/auth/activate`; `?token=…` is appended. The older `AUTH_ACTIVATION_BASE_URL` (below) also satisfies it — `requiredEnv.activationLinkVar` names whichever the install uses. The service starts without it, but registration fails |

### Optional

| variable | default | meaning |
|---|---|---|
| `AUTH_INVITE_URL` | derived | full address of your accept-invite page; `?token=…` is appended |
| `AUTH_ACTIVATION_BASE_URL` | — | older form: an origin; `/auth/activate` and `/auth/accept-invite` are appended when the two URLs above are unset |
| `AUTH_ACCESS_TOKEN_TTL_MINUTES` | `15` | access token lifetime |
| `AUTH_REFRESH_TOKEN_TTL_DAYS` | `7` | refresh token (session) lifetime |
| `AUTH_ACCESS_TOKEN_TOLERANCE_SECONDS` | `0` | grace after expiry during which a token is still served and slid; `0` turns sliding refresh off |
| `AUTH_MAX_SESSIONS_PER_USER` | `5` | concurrent sessions; the oldest are evicted |
| `AUTH_RESET_TOKEN_EXPIRY_MINUTES` | `30` | password reset link lifetime |
| `AUTH_ENABLE_HOOKS` | on | `false` turns every hook off |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | the session store |
| `REDIS_PASSWORD` / `REDIS_DB` | none / `0` | read by `@xeplr/utils`' cache |
| `UPLOAD_DIR` | `./uploads` | where avatar uploads are written |
| `EMAIL_PROVIDER` | not configured | `smtp`, `brevo`, `aws` or `azure` |
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE`, … | | SMTP settings, read by `@xeplr/utils` |
| `BREVO_API_KEY`, `BREVO_FROM_EMAIL`, `BREVO_FROM_NAME` | | Brevo |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SES_FROM` | | Amazon SES |
| `AZURE_COMMUNICATION_CONNECTION_STRING`, `AZURE_EMAIL_FROM` | | Azure Communication Services |

## REDIS_PREFIX is required

Every key auth writes to Redis — sessions, the access-token whitelist, SSE tickets and the access cache — is written under `REDIS_PREFIX`. `@xeplr/utils` falls back to `xeplr:` when it is unset, so **two apps on one Redis** (any developer machine running more than one) read and write the same keys.

Most of those keys contain a token or a user id and never collide. The access cache does not: `access:public` (the menus and pages everyone may see) and `access:api:<name>` (whether an API is open, and to which roles) are named by content. One app fills them from its database and the other serves them as its own:

- the drawer shows another product's menus and drops its own;
- an API the other app never registered is cached as open to everyone, so a guarded route answers any signed-in caller for up to ten minutes — no error, no log line.

So `init()` and `boot()` (and therefore `start()` and `xeplr-auth-server`) **refuse to start**, naming the variable, when `REDIS_PREFIX` is unset, blank, or exactly `xeplr:`. `xeplr:` is refused even when written out, because it is exactly what an env file copied from another project carries.

```
REDIS_PREFIX is not set. Give this app its own, e.g. REDIS_PREFIX=myapp: — apps sharing a Redis without one serve each other's sessions, menus and API permissions.
```

Fix: `REDIS_PREFIX=myapp:` — one value per app, the same in every process of that app.

## Startup

**Redis must be reachable.** `boot()` writes, reads and deletes a probe key before anything else, and exits with instructions if it cannot. Without Redis, login still *succeeds* (minting a token needs no Redis) but the session write fails silently, and every following request answers `Invalid or expired token` — which points at clocks and secrets rather than the missing service.

**The banner** shows the effective configuration, defaults resolved, secrets masked:

```
┌─────────────────────────────────────────────────────────────┐
│ xeplr-auth · running                                        │
├─────────────────────────────────────────────────────────────┤
│ port               19001                                    │
│ database           myapp_auth                               │
│ XEPLR_AUTH_MIGRATIONS./migrations-auth                      │
│ activation url     http://localhost:19100/auth/activate     │
│ invite url         (derived)                                │
│ access token ttl   15m                                      │
│ refresh token ttl  7d                                       │
│ slide tolerance    0s                                       │
│ max sessions/user  5                                        │
│ redis              localhost:6379                           │
│ redis prefix       myapp:                                   │
│ email              ✓ smtp — smtp.example.com:587, connected │
│ connection         XEPLR_DB_CONNECTION                      │
│ encryption key     ✓ set                                    │
│ jwt secret         ✓ set                                    │
└─────────────────────────────────────────────────────────────┘
```

`connection` names the variable the connection was resolved through.

**The email row is a real check**, made by `@xeplr/utils`' `checkEmail` with a 5-second timeout — SMTP connects and authenticates, Brevo has its API key checked, AWS and Azure have their settings checked (not contacted):

| row | meaning |
|---|---|
| `✓ smtp — host:port, connected` | mail can go out |
| `✗ NOT WORKING — reason` | e.g. `not configured (EMAIL_PROVIDER is not set)`, `SMTP_HOST is not set`, a connection error; a warning follows the banner |
| `? not checked — @xeplr/utils is too old to check` | the installed `@xeplr/utils` has no `checkEmail` |

SMTP needs `nodemailer` installed in the app.

**Email is never fatal.** Sign-in, refresh and everything behind a token work without it. What cannot work is anything that sends a link:

- **Registration currently errors without email.** The account row is inserted first; then a missing activation URL, or a failed send, answers `500` — and the unactivated account stays, so registering again answers `409`.
- **Invites** (`authService.invite`) throw the same way.
- **Forgot password** answers `500` for an address that exists (and the usual message for one that does not).

## Migrations

Hand-written `.sql` files, applied once each in their own transaction, tracked by filename in `xeplr_migrations`. No `down()`. `boot()` runs them itself; in-process apps run the CLI.

```sh
AUTH_DB_NAME=myapp_auth xeplr-auth-migrate up --connection-env XEPLR_DB_CONNECTION
xeplr-auth-migrate status --connection-env XEPLR_DB_CONNECTION     # completed, pending, and edited-after-applying
```

| option | |
|---|---|
| `--db <name>` | database; default `AUTH_DB_NAME` |
| `--extDir <dir>[,<dir>…]` | app migration directories; default `XEPLR_AUTH_MIGRATIONS` |
| `--connection-env <VAR>` | read the encrypted connection from that variable |
| `--connection <encrypted>` | the encrypted connection itself |

Without `--connection` or `--connection-env`, the CLI reads `AUTH_CONNECTION` — it does not look at `XEPLR_DB_CONNECTION` or `AUTH_DB_CONNECTION_INFO_ENCRYPTED` on its own. It reads `process.env` only.

**`XEPLR_AUTH_MIGRATIONS`** is a comma-separated list of directories. Auth's own migrations run first, then each directory in order — this is how an app adds its own `apis`, `menus` and role mappings to the auth database, and how several apps (BI, workflow, jobs) land theirs in one database:

```
XEPLR_AUTH_MIGRATIONS=./migrations-auth,./node_modules/@xeplr/factory/migrations-auth
```

- **Filenames must be unique across all the directories.** The ledger is keyed by filename alone: a second `0003_menus.sql` in another directory is treated as already applied and silently skipped.
- A directory that does not exist is an error, not an empty contribution.
- `${VAR}` in a file is replaced with `process.env.VAR`; an unset variable fails the migration by name.

Auth's own migrations:

| file | |
|---|---|
| `0001_extensions` | `pgcrypto` |
| `0002_users` | `users` |
| `0003_catalog_tables` | `roles`, `apis`, `uiPages`, `uiElements`, `menus` |
| `0004_role_mappings` | `apisRolesMapping`, `uiPagesRolesMapping`, `uiElementsRolesMapping`, `menuRolesMapping`, `userRolesMapping` |
| `0005_user_tenants_mapping` | `userTenantsMapping` |
| `0006_seed_catalog` | roles Super Admin, Admin, Editor, Viewer; auth's own apis, pages, elements, menus; Super Admin and Admin mapped to all of them |
| `0007_license_module` | `licenseModule` column (default `core`) on apis, menus, uiPages, uiElements |
| `0008_super_admin` | the first account |
| `0009_menu_labels` | `label`, `sortOrder`, `isHidden` on `menus` |

## The first account

Migration `0008` creates a user from `AUTH_SUPER_ADMIN_EMAIL` / `AUTH_SUPER_ADMIN_PASSWORD` — name `Super Admin`, activated, bcrypt password, tenant `*` — and maps it to the `Super Admin` role. The migrator refuses to run `0008` while either variable is unset, because an install that migrates cleanly with nobody able to sign in fails much later than its cause.

It is created **once**, when migrations first run on that database:

- Changing the variables later creates nothing — `0008` is already in the ledger and never runs again. The old account and its password stay.
- Pointing at an existing database keeps its accounts. If a user with that email already exists when `0008` runs, it keeps its password.

To add or change an account afterwards, use the app (or `seedSuperAdmin(knex, { email, password })` from your own migration code).

## Sessions and tokens

A session is one login on one device: a JWT **access token** (claims `id`, `email`, `name`, `roles`) and a random **refresh token**, both recorded in Redis.

| event | effect |
|---|---|
| login | new session; beyond `AUTH_MAX_SESSIONS_PER_USER` the oldest are ended |
| `POST /refresh` | the old pair is destroyed and a new pair issued, with roles re-read from the database |
| `POST /logout` | that session ends; its access token stops working immediately |
| reset or change password | every session of that user ends |

`authMiddleware` checks, in order: the signature, then that the session is still live in Redis (a logged-out token is never accepted), then expiry.

**Sliding refresh** is on when `AUTH_ACCESS_TOKEN_TOLERANCE_SECONDS` is above `0`. A token that has expired by no more than that many seconds, on a live session, is still served — and the response carries a fresh one:

```
X-New-Token: eyJhbGciOi…
Access-Control-Expose-Headers: X-New-Token
```

Client code must read the header and replace its stored token, or the session ends when the grace runs out. Concurrent requests carrying the same expiring token all get the **same** new token. A slid token copies its roles from the old one; roles are re-read on `/refresh` or the next login. A revoked session is never graced.

## Routes

### `/auth/api`

| route | token | body / query → response |
|---|---|---|
| `POST /register` | — | `{ email, password, name?, phoneNumber? }` → `201 { message, user }`; `409` if the email is registered. Sends the activation email |
| `GET /activate` | — | `?token=…&workflowKey=…` → `{ message, user }` |
| `GET /invite-preview` | — | `?token=…` → `{ email, name }` |
| `POST /invite-accept` | — | `{ token, password, name? }` → sets the password and activates |
| `POST /login` | — | `{ email, password }` → `{ accessToken, refreshToken, user, access }`; `401` wrong password or deactivated; `403` not yet activated |
| `POST /refresh` | — | `{ refreshToken }` → a new `{ accessToken, refreshToken, user, access }` |
| `POST /logout` | — | `{ refreshToken }` → ends that session |
| `POST /forgot-password` | — | `{ email }` → the same message whether or not the address exists; emails `<resetBaseUrl>/auth/reset-password?token=…` (the request's own origin when no `resetBaseUrl` is given — `boot()` gives none) |
| `POST /reset-password` | — | `{ token, newPassword }` |
| `GET /me` | ✓ | `{ user, access }` — `user` is the token's claims |
| `GET /profile` · `PUT /profile` | ✓ | `{ id, email, name, phoneNumber, phoneVerified, profilePicUrl, isActivated }`; PUT takes `name`, `phoneNumber`, `email` |
| `POST /profile/avatar` | ✓ | multipart `avatar`, an image up to 2 MB; stores the file name only — serving `UPLOAD_DIR` is the app's job |
| `POST /change-password` | ✓ | `{ oldPassword, newPassword }`; ends every session |
| `POST /request-phone-otp` | ✓ | `{ phoneNumber? }` — needs an SMS provider registered with `@xeplr/utils` |
| `POST /verify-phone-otp` | ✓ | `{ code }` → `{ phoneVerified: true }` |
| `POST /sse-ticket` | ✓ | `{ scopes? }` (default `['user:me:*']`) → `{ ticket, expiresIn: 30 }` |

### `/auth/api/admin`

**Every admin route requires a valid token — and most require nothing more.** Any signed-in user can call them unless you mount `accessMiddleware()` or `requireRole()` in front. Only the `menu-items` routes check a role themselves: **Super Admin**, read from the token's `roles` (403 otherwise).

| route | |
|---|---|
| `GET /users` | users with their roles |
| `GET /roles` | `[{ id, name }]` |
| `GET /access-items` | `{ apis, pages, elements, menus }`, each with its roles |
| `POST /user-role` | `{ userId, roleId, assign }` — grant or remove a role |
| `POST /access-role` | `{ type: apis\|pages\|elements\|menus, itemId, roleId, assign }` |
| `POST /module-role` | `{ module, action, roleId, assign }` — every item of every type whose group is `module:action` |
| `GET /master/<type>` | `<type>` is `roles`, `apis`, `pages`, `elements` or `menus` |
| `POST /master/<type>` | `{ id?, name, … }` — update with `id`, create without |
| `POST /master/<type>/delete` | `{ id }` |
| `GET /menu-items` | Super Admin — [menu keys and labels](#menu-keys-and-labels) |
| `POST /menu-items` | Super Admin — `{ items: [{ name, label, sortOrder, isHidden }] }` |
| `POST /menu-items/add` | Super Admin — `{ name, label, isPublic? }` |
| `POST /menu-items/remove` | Super Admin — `{ name }` |

## The access object

`/login`, `/refresh` and `/me` return what the user may use — the union of their roles' mappings and every `isPublic` row:

```json
{
  "roles": ["Admin"],
  "pages": ["Profile", "User Roles"],
  "apis": ["/auth/api/me", "/auth/api/admin/users"],
  "menus": ["Tasks", "Profile"],
  "menuItems": [{ "name": "Tasks", "label": "TSK", "sortOrder": 1 }, { "name": "Profile", "label": "Profile", "sortOrder": null }],
  "elements": ["Assign Role Button"]
}
```

- `menus` are **keys** — what app code matches on.
- `menuItems` are what to show for those keys, **in rail order**: by `sortOrder`, rows without one after, ties by label. `label` falls back to the key. **Hidden items are left out** of both.

**Cached in Redis** (under `REDIS_PREFIX`):

| key | lifetime | cleared by |
|---|---|---|
| `access:user:<id>` — the object above | 5 min | that user's login, `POST /user-role` for that user, any `menu-items` change |
| `access:userRoles:<id>` — role ids for `accessMiddleware` | 5 min | that user's login, `POST /user-role` |
| `access:public` — public apis, pages, menus | 10 min | `access-role`, `module-role`, any delete, any `menu-items` change |
| `access:api:<name>` — one API's rule | 10 min | the same |

Menu-item changes clear every cached access object, so the `/me` the UI asks for next already carries them. Other catalog changes clear only the shared rules; another user's own access object can lag by up to 5 minutes.

## Menu keys and labels

Migration `0009` splits what code refers to from what people read:

| column | |
|---|---|
| `name` | the **key**. What app code matches in `drawerItems` / `settingsOverrides`, and what roles are mapped to. Never shown; never renamed |
| `label` | what people see. Empty shows the key |
| `sortOrder` | position in the rail; empty sorts after the numbered ones |
| `isHidden` | kept and still role-mapped, but not shown — reversible, unlike delete |

Why the split: renaming a menu in the UI must not break the code that looks it up or the role mappings that grant it.

An app's own menu rows come from its `migrations-auth` SQL, with `name` = key. After that, a Super Admin changes how they look from the app:

```
GET  /auth/api/admin/menu-items
→ [{ id, name, label, shown, sortOrder, isHidden, isPublic, menuGroup }]      every row, hidden included

POST /auth/api/admin/menu-items         { "items": [{ "name": "Tasks", "label": "TSK", "sortOrder": 1, "isHidden": false }] }
→ { changed }        only label, sortOrder and isHidden change; label null or "" clears it; sortOrder is a whole number or null

POST /auth/api/admin/menu-items/add     { "name": "form:crop", "label": "Crops", "isPublic": true }
→ { name, created }  e.g. a form added to the menu; public unless isPublic is false; placed last;
                     an existing key is relabelled and un-hidden instead of duplicated

POST /auth/api/admin/menu-items/remove  { "name": "form:crop" }
→ { removed }        deletes the row and its role mappings
```

Bad input answers `400` with the reason.

## Access checks

**`accessMiddleware(options)`** guards your own API routes from the `apis` catalog:

```js
app.use('/api', auth.accessMiddleware())       // API name = req.baseUrl + req.path, e.g. "/api/orders"
```

| the API is | result |
|---|---|
| not in `apis` | open |
| `isPublic` | open |
| in `apis` with no roles mapped | open |
| mapped to roles | Bearer token required (signature and expiry — not the Redis session); `403 Access denied` unless the user holds one of those roles |

Pass `apiNameResolver(req)` to name APIs differently. Because unregistered means open, register every route that must be guarded.

**`requireRole('Admin', 'Super Admin')`** checks the role names in the token, with no database lookup.

## Multi-tenancy

`userTenantsMapping` records membership: `userId`, `level` (`l1`–`l4`, matching `mtId1`–`mtId4`), `value` (the app's own id at that level — auth owns no tenant tree), an optional `roleId`, `isActive`. One row per user, level and value.

`@xeplr/db`'s `mtMiddleware` trusts whatever tenant header it is given. `mtMembershipMiddleware` is what checks it: for each configured slot whose header is present, the caller needs an active membership row with that value, or gets `403 Not authorized for <slot> "<value>"`. An absent header is left alone. It does nothing when multi-tenancy is not enabled.

```js
app.use(authMiddleware)                        // needs req.user.id
app.use(mtMiddleware())                        // @xeplr/db
app.use(auth.mtMembershipMiddleware())         // auth initialised in this process
// auth running as its own service:
app.use(auth.mtMembershipMiddleware({ userTenantsMapping: authAttach.model('UserTenantsMapping') }))
```

## Hooks

```js
auth.hooks.on('user', 'create', async function(id) { /* … */ })
```

One handler per identifier and event — registering again replaces it. A handler that throws is logged and never breaks the operation.

| identifier | events |
|---|---|
| `user` | `create` (register, invite), `update` (activate, invite accepted, password and profile changes), `login` |
| `roles` | `create`, `update`, `delete` |
| `apis`, `pages`, `elements`, `menus` | `create`, `update`, `delete` — the `master` routes |
| `userRolesMapping` | `create`, `delete` |
| `apisRolesMapping`, `pagesRolesMapping`, `elementsRolesMapping`, `menusRolesMapping` | `create`, `delete` |

Hooks run in the process that did the work — register them in the same script that calls `boot()`, not in your API process.

## Tests

```sh
npm test          # node --test test/*.test.js
```

`test/menuItems.test.js` needs a local PostgreSQL (the usual `PG*` variables): it creates and drops a throwaway database, and is skipped when none is reachable. The token-decision and `REDIS_PREFIX` tests need nothing.

## License

MIT
