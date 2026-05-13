-- Migration: Add language preference fields to user_sessions
-- Users select a language once; preference is stored for 7 days to avoid
-- per-message Gemini language-detection calls.

ALTER TABLE user_sessions
  ADD COLUMN IF NOT EXISTS language VARCHAR(10),
  ADD COLUMN IF NOT EXISTS language_set_at TIMESTAMP WITH TIME ZONE;
