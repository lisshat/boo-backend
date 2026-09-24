-- Manual deployment for Email Verification Foundation Batch 6B.
-- Existing users intentionally remain unconfirmed (email_verified_at IS NULL).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz NULL;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  verification_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz NULL,
  last_sent_at timestamptz NOT NULL,
  delivery_failed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT email_verification_failed_attempts_check
    CHECK (failed_attempts >= 0 AND failed_attempts <= 5),
  CONSTRAINT email_verification_expiry_check
    CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_email_verification_user_created
  ON email_verification_codes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_verification_active
  ON email_verification_codes(user_id, consumed_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_expires
  ON email_verification_codes(expires_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_verification_failed_attempts_check'
      AND conrelid = 'email_verification_codes'::regclass
  ) THEN
    ALTER TABLE email_verification_codes
      ADD CONSTRAINT email_verification_failed_attempts_check
      CHECK (failed_attempts >= 0 AND failed_attempts <= 5);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_verification_expiry_check'
      AND conrelid = 'email_verification_codes'::regclass
  ) THEN
    ALTER TABLE email_verification_codes
      ADD CONSTRAINT email_verification_expiry_check
      CHECK (expires_at > created_at);
  END IF;
END $$;

-- Verification queries after deployment:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'email_verified_at';
-- SELECT COUNT(*) AS verification_code_rows,
--        COUNT(*) FILTER (WHERE consumed_at IS NULL) AS active_rows
--   FROM email_verification_codes;
