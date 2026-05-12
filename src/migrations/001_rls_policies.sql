-- =============================================================================
-- 001_rls_policies.sql
-- Row-Level Security for all tenant-scoped tables.
--
-- Context variables (set per-request by the Node.js middleware):
--   app.current_client_id  — UUID of the authenticated client (empty for admin)
--   app.current_role       — 'admin' | 'client'
--
-- Admin requests: app.current_role = 'admin'  → all rows visible
-- Client requests: only rows where client_id matches app.current_client_id
--
-- IDEMPOTENT: safe to re-run on every app start.
-- =============================================================================

-- ── user_sessions ─────────────────────────────────────────────────────────────
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON user_sessions;
CREATE POLICY tenant_isolation ON user_sessions
  AS PERMISSIVE FOR ALL
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  );

-- ── content ───────────────────────────────────────────────────────────────────
ALTER TABLE content ENABLE ROW LEVEL SECURITY;
ALTER TABLE content FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON content;
CREATE POLICY tenant_isolation ON content
  AS PERMISSIVE FOR ALL
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  );

-- ── service_requests ──────────────────────────────────────────────────────────
ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON service_requests;
CREATE POLICY tenant_isolation ON service_requests
  AS PERMISSIVE FOR ALL
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  );

-- ── processed_messages ────────────────────────────────────────────────────────
ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON processed_messages;
CREATE POLICY tenant_isolation ON processed_messages
  AS PERMISSIVE FOR ALL
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  );

-- ── employees ─────────────────────────────────────────────────────────────────
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON employees;
CREATE POLICY tenant_isolation ON employees
  AS PERMISSIVE FOR ALL
  USING (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  )
  WITH CHECK (
    current_setting('app.current_role', true) = 'admin'
    OR client_id::text = NULLIF(current_setting('app.current_client_id', true), '')
  );
