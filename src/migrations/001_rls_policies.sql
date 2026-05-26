-- =============================================================================
-- 001_rls_policies.sql
-- Row-Level Security for all tenant-scoped tables.
--
-- Context variable (set per-request by the Node.js middleware):
--   app.tenant_id  — UUID of the tenant this container serves
--
-- Every query is automatically filtered to rows where tenant_id matches
-- the container's own TENANT_ID env var. One container = one tenant.
-- A query that forgets to filter is still safe — PostgreSQL blocks it here.
--
-- IDEMPOTENT: safe to re-run on every app start.
-- =============================================================================

-- ── user_sessions ─────────────────────────────────────────────────────────────
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON user_sessions;
CREATE POLICY tenant_isolation ON user_sessions
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);

-- ── content ───────────────────────────────────────────────────────────────────
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE content FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON content;
CREATE POLICY tenant_isolation ON content
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);

-- ── service_requests ──────────────────────────────────────────────────────────
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON service_requests;
CREATE POLICY tenant_isolation ON service_requests
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);

-- ── processed_messages ────────────────────────────────────────────────────────
ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON processed_messages;
CREATE POLICY tenant_isolation ON processed_messages
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);

-- ── employees ─────────────────────────────────────────────────────────────────
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON employees;
CREATE POLICY tenant_isolation ON employees
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);

-- ── client_general_info ───────────────────────────────────────────────────────
ALTER TABLE client_general_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_general_info FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON client_general_info;
CREATE POLICY tenant_isolation ON client_general_info
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);

-- ── form_tokens ───────────────────────────────────────────────────────────────
ALTER TABLE form_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE form_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON form_tokens;
CREATE POLICY tenant_isolation ON form_tokens
  AS PERMISSIVE FOR ALL
  USING (tenant_id = current_setting('app.tenant_id')::UUID)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::UUID);
