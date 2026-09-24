CREATE TABLE IF NOT EXISTS reports (
  report_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_user_id uuid NOT NULL REFERENCES users(id),
  reported_user_id uuid NOT NULL REFERENCES users(id),
  provider_profile_id uuid REFERENCES provider_profiles(profile_id),
  booking_id uuid REFERENCES bookings(booking_id),
  stream_channel_type varchar(50),
  stream_channel_id varchar(128),
  reason varchar(40) NOT NULL CONSTRAINT reports_reason_check CHECK (reason IN (
    'harassment', 'threats', 'scam', 'spam', 'inappropriate_content',
    'unsafe_conduct', 'discrimination', 'other'
  )),
  description text,
  status varchar(20) NOT NULL DEFAULT 'submitted' CONSTRAINT reports_status_check CHECK (status IN (
    'submitted', 'reviewing', 'resolved', 'dismissed'
  )),
  assigned_admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_status_created_at
  ON reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_reported_user_status
  ON reports(reported_user_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_created_at
  ON reports(reporter_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_booking_id ON reports(booking_id);
CREATE INDEX IF NOT EXISTS idx_reports_stream_channel_id
  ON reports(stream_channel_id);

-- These blocks also make the script safe to rerun after a table was created
-- by an earlier version without the constraints. Existing invalid rows must
-- be corrected manually before PostgreSQL can add either constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_reason_check'
      AND conrelid = 'reports'::regclass
  ) THEN
    ALTER TABLE reports ADD CONSTRAINT reports_reason_check CHECK (reason IN (
      'harassment', 'threats', 'scam', 'spam', 'inappropriate_content',
      'unsafe_conduct', 'discrimination', 'other'
    ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reports_status_check'
      AND conrelid = 'reports'::regclass
  ) THEN
    ALTER TABLE reports ADD CONSTRAINT reports_status_check CHECK (status IN (
      'submitted', 'reviewing', 'resolved', 'dismissed'
    ));
  END IF;
END $$;
