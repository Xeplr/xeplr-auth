-- 0003_catalog_tables.sql
-- roles + the four access-catalog tables (apis/uiPages/uiElements/menus),
-- each independently role-mappable and each with an isPublic escape hatch
-- (accessService.getPublicItems() unions isPublic:true rows into every
-- authenticated user's access regardless of role).

CREATE TABLE "roles" (
  "id" varchar(25) PRIMARY KEY,
  "name" varchar(255),
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

CREATE TABLE "apis" (
  "id" varchar(25) PRIMARY KEY,
  "name" varchar(255),
  "apiGroup" varchar(255),
  "isPublic" boolean DEFAULT false,
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

CREATE TABLE "uiPages" (
  "id" varchar(25) PRIMARY KEY,
  "name" varchar(255),
  "uiPagesGroup" varchar(255),
  "isPublic" boolean DEFAULT false,
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

CREATE TABLE "uiElements" (
  "id" varchar(25) PRIMARY KEY,
  "name" varchar(255),
  "uiElementsGroup" varchar(255),
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

CREATE TABLE "menus" (
  "id" varchar(25) PRIMARY KEY,
  "name" varchar(255),
  "menuGroup" varchar(255),
  "isPublic" boolean DEFAULT false,
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
