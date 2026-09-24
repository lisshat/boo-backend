-- Manual one-time deployment for Booking Payment Record & Price Snapshot Batch 5A.
-- Run against the production database only after review. This file is not
-- executed by NestJS startup.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS agreed_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS pricing_unit_snapshot varchar(30),
  ADD COLUMN IF NOT EXISTS duration_minutes_snapshot integer,
  ADD COLUMN IF NOT EXISTS snapshot_source varchar(30) NOT NULL DEFAULT 'booking_time',
  ADD COLUMN IF NOT EXISTS payment_status varchar(40) NOT NULL DEFAULT 'not_recorded',
  ADD COLUMN IF NOT EXISTS payment_method varchar(30),
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_record_reversed_at timestamptz;

-- Existing rows are compatibility estimates from the current service record;
-- they are explicitly marked as legacy_backfill and are not historical proof.
UPDATE bookings b
SET agreed_amount = ROUND((
      CASE
        WHEN s.pricing_unit = 'per_hour'
          THEN s.price * (s.duration_minutes::numeric / 60.0)
        WHEN s.pricing_unit IN ('per_day', 'per_night')
          THEN s.price * (s.duration_minutes::numeric / 1440.0)
        ELSE s.price
      END
    ), 2),
    pricing_unit_snapshot = s.pricing_unit,
    duration_minutes_snapshot = s.duration_minutes,
    snapshot_source = 'legacy_backfill'
FROM services s
WHERE b.service_id = s.service_id
  AND (b.agreed_amount IS NULL
    OR b.pricing_unit_snapshot IS NULL
    OR b.duration_minutes_snapshot IS NULL);

UPDATE bookings
SET payment_status = 'not_recorded'
WHERE payment_status IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_payment_status_check'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check
      CHECK (payment_status IN ('not_recorded', 'provider_recorded_received'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bookings_payment_method_check'
  ) THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('cash', 'mpesa', 'bank_transfer', 'other'));
  END IF;
END $$;

-- Verification queries (run separately after deployment):
-- SELECT COUNT(*) FROM bookings WHERE payment_status <> 'not_recorded';
-- SELECT snapshot_source, COUNT(*) FROM bookings GROUP BY snapshot_source;
-- SELECT COUNT(*) FROM bookings WHERE agreed_amount IS NULL
--    OR pricing_unit_snapshot IS NULL OR duration_minutes_snapshot IS NULL;
