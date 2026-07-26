-- 0002_users.sql

CREATE TABLE "users" (
  "id" varchar(25) PRIMARY KEY,
  "email" varchar(255) NOT NULL,
  "normalizedEmail" varchar(255),
  "phoneNumber" varchar(255),
  "phoneVerified" boolean DEFAULT false,
  "phoneVerifiedOn" timestamp,
  "name" varchar(255),
  "pwd" varchar(255),
  "pwdSalt" varchar(100),
  "profilePicUrl" varchar(500),
  "isActive" boolean DEFAULT false,
  "isActivated" boolean DEFAULT false,
  "activatedOn" timestamp,
  "activatedBy" varchar(25),
  "resetToken" varchar(255),
  "resetTokenExpiry" timestamp,
  "activationToken" varchar(255),
  "mtId1" varchar(25),
  "mtId2" varchar(25),
  "mtId3" varchar(25),
  "mtId4" varchar(25),
  "recordCreatedDate" timestamp,
  "recordModifiedDate" timestamp,
  "recordCreatedBy" varchar(25),
  "recordModifiedBy" varchar(25)
);

CREATE INDEX "users_normalizedEmail_index" ON "users" ("normalizedEmail");
