-- 0005_user_tenants_mapping.sql
-- Row-per-level membership registry. `level` is the generic MT slot (l1-l4,
-- matching mtId1-4) — not the app-defined name (companyId/workspaceId/...);
-- that name<->slot mapping lives only in the app's own registerMTs() config
-- (see @xeplr/db's BaseModel.registerMTs). `value` is the app's own id at
-- that level — auth doesn't own or validate a tenant tree, it just records
-- "this user is a member at this level with this value".
--
-- This table is deliberately NOT multiTenant-filtered by BaseModel (see
-- UserTenantsMapping.js's `multiTenant: false`) — it must be queryable before
-- any active scope exists (chicken-and-egg: you need this table to find out
-- which company to activate in the first place).

CREATE TABLE "userTenantsMapping" (
  "id" varchar(25) PRIMARY KEY,
  "userId" varchar(25) NOT NULL REFERENCES "users"("id"),
  "level" varchar(2) NOT NULL CHECK ("level" IN ('l1', 'l2', 'l3', 'l4')),
  "value" varchar(255) NOT NULL,
  "roleId" varchar(25) REFERENCES "roles"("id"),
  "isActive" boolean DEFAULT true,
  "mtId1" varchar(25),
  "mtId2" varchar(25),
  "mtId3" varchar(25),
  "mtId4" varchar(25),
  "recordCreatedDate" timestamp,
  "recordModifiedDate" timestamp,
  "recordCreatedBy" varchar(25),
  "recordModifiedBy" varchar(25),
  UNIQUE ("userId", "level", "value")
);

-- Enforcement lookup (mtMembershipMiddleware): "does this user have a grant
-- at level X with value Y?"
CREATE INDEX "userTenantsMapping_userId_level_value_index"
  ON "userTenantsMapping" ("userId", "level", "value");

-- "Who has access to this company/workspace?" lookups.
CREATE INDEX "userTenantsMapping_level_value_index"
  ON "userTenantsMapping" ("level", "value");
