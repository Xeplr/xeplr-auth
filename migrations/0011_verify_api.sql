-- 0011_verify_api.sql
-- GET /auth/api/verify — the check every app's gate makes on every request:
-- the token AND the caller's access state for the API being served.
--
-- Public in the catalog (like /refresh): it carries its own token check, and
-- a role mapping on it would make the gate's own question depend on the
-- answer to itself.

INSERT INTO "apis" (id, name, "apiGroup", "isPublic", "isActive", "mtId1", "recordCreatedDate", "recordModifiedDate")
SELECT encode(gen_random_bytes(12), 'hex'), 'GET /auth/api/verify', '', true, true, '*', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "apis" WHERE name = 'GET /auth/api/verify' AND "apiGroup" = '');
