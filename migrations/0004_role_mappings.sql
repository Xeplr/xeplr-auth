-- 0004_role_mappings.sql
-- Join tables: which roles can see which api/page/element/menu, and which
-- users hold which roles.

CREATE TABLE "apisRolesMapping" (
  "id" varchar(25) PRIMARY KEY,
  "roleId" varchar(25) REFERENCES "roles"("id"),
  "apiId" varchar(25) REFERENCES "apis"("id"),
  "isActive" boolean DEFAULT false,
  "mtId1" varchar(25),
  "mtId2" varchar(25),
  "mtId3" varchar(25),
  "mtId4" varchar(25),
  "recordCreatedDate" timestamp,
  "recordModifiedDate" timestamp,
  "recordCreatedBy" varchar(25),
  "recordModifiedBy" varchar(25)
);

CREATE TABLE "uiPagesRolesMapping" (
  "id" varchar(25) PRIMARY KEY,
  "roleId" varchar(25) REFERENCES "roles"("id"),
  "uiPageId" varchar(25) REFERENCES "uiPages"("id"),
  "isActive" boolean DEFAULT false,
  "mtId1" varchar(25),
  "mtId2" varchar(25),
  "mtId3" varchar(25),
  "mtId4" varchar(25),
  "recordCreatedDate" timestamp,
  "recordModifiedDate" timestamp,
  "recordCreatedBy" varchar(25),
  "recordModifiedBy" varchar(25)
);

CREATE TABLE "uiElementsRolesMapping" (
  "id" varchar(25) PRIMARY KEY,
  "roleId" varchar(25) REFERENCES "roles"("id"),
  "uiElementId" varchar(25) REFERENCES "uiElements"("id"),
  "isActive" boolean DEFAULT false,
  "mtId1" varchar(25),
  "mtId2" varchar(25),
  "mtId3" varchar(25),
  "mtId4" varchar(25),
  "recordCreatedDate" timestamp,
  "recordModifiedDate" timestamp,
  "recordCreatedBy" varchar(25),
  "recordModifiedBy" varchar(25)
);

CREATE TABLE "menuRolesMapping" (
  "id" varchar(25) PRIMARY KEY,
  "menuId" varchar(25) REFERENCES "menus"("id"),
  "roleId" varchar(25) REFERENCES "roles"("id"),
  "isActive" boolean DEFAULT false,
  "mtId1" varchar(25),
  "mtId2" varchar(25),
  "mtId3" varchar(25),
  "mtId4" varchar(25),
  "recordCreatedDate" timestamp,
  "recordModifiedDate" timestamp,
  "recordCreatedBy" varchar(25),
  "recordModifiedBy" varchar(25)
);

CREATE TABLE "userRolesMapping" (
  "id" varchar(25) PRIMARY KEY,
  "userId" varchar(25) REFERENCES "users"("id"),
  "roleId" varchar(25) REFERENCES "roles"("id"),
  "isActive" boolean DEFAULT false,
  "mtId1" varchar(25),
  "mtId2" varchar(25),
  "mtId3" varchar(25),
  "mtId4" varchar(25),
  "recordCreatedDate" timestamp,
  "recordModifiedDate" timestamp,
  "recordCreatedBy" varchar(25),
  "recordModifiedBy" varchar(25)
);
