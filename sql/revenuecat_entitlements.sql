-- Manual deployment for RevenueCat entitlement projection and pet-limit
-- enforcement (Batch 8F). Production synchronization is disabled.
-- Do not execute this file from application startup.

-- Preflight (run separately and stop if either new table already exists with
-- a different shape):
-- SELECT to_regclass('public.revenuecat_webhook_events');
-- SELECT to_regclass('public.user_entitlements');

CREATE TABLE IF NOT EXISTS revenuecat_webhook_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id varchar(255) NOT NULL,
  event_type varchar(64) NOT NULL,
  event_timestamp timestamptz NOT NULL,
  status varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_revenuecat_webhook_events_event_id UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_revenuecat_webhook_events_timestamp
  ON revenuecat_webhook_events (event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_revenuecat_webhook_events_status
  ON revenuecat_webhook_events (status);

CREATE TABLE IF NOT EXISTS user_entitlements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entitlement_id varchar(80) NOT NULL,
  product_id varchar(160) NULL,
  environment varchar(32) NOT NULL,
  active_until timestamptz NULL,
  will_renew boolean NULL,
  latest_event_timestamp timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_entitlements_user_entitlement
    UNIQUE (user_id, entitlement_id),
  CONSTRAINT user_entitlements_entitlement_check
    CHECK (entitlement_id IN ('boo_plus', 'boo_pro'))
);

CREATE INDEX IF NOT EXISTS idx_user_entitlements_active_lookup
  ON user_entitlements (user_id, entitlement_id, active_until);
CREATE INDEX IF NOT EXISTS idx_user_entitlements_latest_event
  ON user_entitlements (latest_event_timestamp DESC);

-- Verification after reviewed deployment:
-- SELECT to_regclass('public.revenuecat_webhook_events');
-- SELECT to_regclass('public.user_entitlements');
-- SELECT COUNT(*) FROM revenuecat_webhook_events;
-- SELECT COUNT(*) FROM user_entitlements;
