-- 007: per-client booking type configuration + bookingType on service_requests

-- clients: which booking types this client offers (default: calendar only)
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS booking_types JSONB NOT NULL DEFAULT '["calendar"]'::JSONB;

-- service_requests: track which booking type generated this record
ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS booking_type VARCHAR(32) NOT NULL DEFAULT 'calendar';

-- service_requests: relax email constraint so restaurant/hotel bookings (no email) can be stored
ALTER TABLE service_requests
  ALTER COLUMN email DROP NOT NULL;
