-- Migration 004: General business information per client
CREATE TABLE IF NOT EXISTS client_general_info (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  business_name   VARCHAR(255),
  industry        VARCHAR(255),
  description     TEXT,
  phone           VARCHAR(50),
  email           VARCHAR(255),
  website         VARCHAR(500),
  address         TEXT,
  area            VARCHAR(255),
  city            VARCHAR(255),
  maps_link       VARCHAR(500),
  hours           JSONB NOT NULL DEFAULT '{}',
  faqs            JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS idx_client_general_info_client_id ON client_general_info(client_id);
