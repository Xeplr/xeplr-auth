-- 0009_menu_labels.sql
--
-- A menu item's NAME is its key: what code refers to (drawerItems), what roles
-- are mapped to, never shown. Its LABEL is what people read, and can be renamed
-- in the app without touching code. Empty label → the name is shown.
--
--   label       shown text ("TSK" for the key "Tasks")
--   sortOrder   position in the rail; empty sorts after the numbered ones
--   isHidden    kept, still role-mapped, but not shown — reversible, unlike delete

ALTER TABLE "menus" ADD COLUMN IF NOT EXISTS "label" varchar(255);
ALTER TABLE "menus" ADD COLUMN IF NOT EXISTS "sortOrder" integer;
ALTER TABLE "menus" ADD COLUMN IF NOT EXISTS "isHidden" boolean NOT NULL DEFAULT false;
