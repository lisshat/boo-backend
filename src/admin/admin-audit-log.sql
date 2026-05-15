CREATE TABLE IF NOT EXISTS admin_audit_log (
  log_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id uuid REFERENCES users(id),
  action varchar(100) NOT NULL,
  target_type varchar(50),
  target_id uuid,
  details jsonb,
  performed_at TIMESTAMPTZ DEFAULT NOW()
);
