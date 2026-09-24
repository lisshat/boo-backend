-- Manual deployment for Secure Password Recovery Batch 6D.
-- Run in a reviewed PostgreSQL deployment transaction. Do not run from app startup.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS password_reset_codes (
  reset_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz NULL,
  last_sent_at timestamptz NOT NULL,
  delivery_failed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_failed_attempts_check CHECK (failed_attempts BETWEEN 0 AND 5),
  CONSTRAINT password_reset_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_created
  ON password_reset_codes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_reset_active
  ON password_reset_codes (user_id, consumed_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_expires
  ON password_reset_codes (expires_at);

-- Preflight before running this file:
-- SELECT to_regclass('public.password_reset_codes');
-- Expected on first deployment: NULL. If it already exists, stop and inspect
-- its columns and constraints; do not assume IF NOT EXISTS upgraded it.

-- Delete obsolete plaintext reset-token records. The old table is retained for
-- an explicit schema cleanup decision, but no old token data remains usable.
DO $$
BEGIN
  IF to_regclass('password_reset_tokens') IS NOT NULL THEN
    DELETE FROM password_reset_tokens;
  END IF;
END $$;

-- Verification queries:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name IN ('users', 'password_reset_codes');
-- SELECT to_regclass('public.password_reset_codes');
-- SELECT to_regclass('public.password_reset_tokens');
