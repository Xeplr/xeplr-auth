-- 0001_extensions.sql
-- pgcrypto gives us gen_random_bytes() for id generation (see 0006's
-- encode(gen_random_bytes(12),'hex') — matches the app's own generateId()
-- shape) and crypt()/gen_salt('bf') — real bcrypt-compatible hashes, usable
-- from plain SQL for any app-level super-admin bootstrap migration (see
-- lib/seed.js's seedSuperAdmin, or roll your own like this). Node's `bcrypt`
-- package can compare() against these hashes directly (same algorithm family).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
