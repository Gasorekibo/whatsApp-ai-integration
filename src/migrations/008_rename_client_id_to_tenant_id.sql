-- =============================================================================
-- 008_rename_client_id_to_tenant_id.sql
--
-- Renames the client_id column to tenant_id on all tenant-scoped tables.
-- Also drops old indexes and recreates them with updated names.
--
-- IDEMPOTENT: wrapped in DO blocks so re-running is safe.
-- =============================================================================

-- ── user_sessions ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_sessions' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE user_sessions RENAME COLUMN client_id TO tenant_id;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_user_sessions_client_phone;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_tenant_phone ON user_sessions (tenant_id, phone);

-- ── employees ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE employees RENAME COLUMN client_id TO tenant_id;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_employees_client_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_tenant_email ON employees (tenant_id, email);

-- ── content ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'content' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE content RENAME COLUMN client_id TO tenant_id;
  END IF;
END $$;

-- ── service_requests ──────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'service_requests' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE service_requests RENAME COLUMN client_id TO tenant_id;
  END IF;
END $$;

-- ── processed_messages ────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'processed_messages' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE processed_messages RENAME COLUMN client_id TO tenant_id;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_processed_messages_client_msg;
CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_messages_tenant_msg ON processed_messages (tenant_id, message_id);

-- ── client_general_info ───────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_general_info' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE client_general_info RENAME COLUMN client_id TO tenant_id;
  END IF;
END $$;

-- ── form_tokens ───────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'form_tokens' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE form_tokens RENAME COLUMN client_id TO tenant_id;
  END IF;
END $$;
