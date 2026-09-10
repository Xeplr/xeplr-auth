-- Which SOLD MODULE each catalog row belongs to.
--
-- This is a second, independent axis from the existing *Group columns:
--
--   apiGroup / menuGroup / ...  = what FUNCTION it is. Roles grant it, and the
--                                 CUSTOMER'S admin controls those roles.
--   licenseModule               = which PRODUCT it was sold as. Only Xeplr
--                                 writes this, and no role can escape it.
--
-- Effective access is the intersection: a company admin holding
-- 'configuration:view' still cannot see the Warehouse menu if the company is
-- not licensed for the warehouse module. That matters because Super Admin is
-- granted every menu by an unfiltered CROSS JOIN (see xeplr-bi's
-- 0007_warehouse_menu.sql) — so entitlement CANNOT be expressed as a role.
--
-- Deliberately not called "service": that word already means "which package
-- wrote this row" (attachConfig({ service })), and applicationId already means
-- "which deployment owns it". This is a third thing — which line item on the
-- price list — and reusing either name would collide with a documented meaning.
--
-- Default 'core' on purpose. Login, company selection, the account menu and the
-- home page belong to no product; if they were tagged 'bi' an unlicensed
-- company could not even sign in to see that it is unlicensed. Backfilling
-- everything to 'core' means adding this column changes no behaviour at all
-- until rows are deliberately re-tagged.

ALTER TABLE "apis"       ADD COLUMN IF NOT EXISTS "licenseModule" varchar(50) NOT NULL DEFAULT 'core';
ALTER TABLE "menus"      ADD COLUMN IF NOT EXISTS "licenseModule" varchar(50) NOT NULL DEFAULT 'core';
ALTER TABLE "uiPages"    ADD COLUMN IF NOT EXISTS "licenseModule" varchar(50) NOT NULL DEFAULT 'core';
ALTER TABLE "uiElements" ADD COLUMN IF NOT EXISTS "licenseModule" varchar(50) NOT NULL DEFAULT 'core';

CREATE INDEX IF NOT EXISTS "apis_licenseModule_index"       ON "apis" ("licenseModule");
CREATE INDEX IF NOT EXISTS "menus_licenseModule_index"      ON "menus" ("licenseModule");
CREATE INDEX IF NOT EXISTS "uiPages_licenseModule_index"    ON "uiPages" ("licenseModule");
CREATE INDEX IF NOT EXISTS "uiElements_licenseModule_index" ON "uiElements" ("licenseModule");
