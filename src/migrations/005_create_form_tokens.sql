-- Migration 005: Shareable form tokens for client onboarding
CREATE TABLE IF NOT EXISTS form_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token       VARCHAR(64) NOT NULL UNIQUE,
  tenant_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP INDEX IF EXISTS idx_form_tokens_client_id;
CREATE INDEX IF NOT EXISTS idx_form_tokens_token     ON form_tokens(token);
CREATE INDEX IF NOT EXISTS idx_form_tokens_tenant_id ON form_tokens(tenant_id);
