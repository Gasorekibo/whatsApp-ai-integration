-- Add require_deposit_before_booking column to clients table
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS require_deposit_before_booking BOOLEAN NOT NULL DEFAULT false;
