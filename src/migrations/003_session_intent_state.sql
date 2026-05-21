-- Migration 003: Document intent state fields on user_sessions
-- The activeIntent, activeOrderType, and aiPaused flags live inside the
-- existing JSONB `state` column — no schema change is needed.
--
-- Expected state shape after this feature:
-- {
--   "activeIntent":    "general" | "services" | "order" | "handoff" | null,
--   "activeOrderType": "booking" | "payment"  | "status" | null,
--   "aiPaused":        true | false,
--   "pausedAt":        "<ISO timestamp>" | null,
--   "selectedService": "<id>" | null,
--   "email":           "<email>" | null
-- }
--
-- One-time cleanup: clear stale awaitingLanguage flags left by the old
-- language-gate implementation (pre-intent-routing). Run once after deploy.

UPDATE user_sessions
SET state = state - 'awaitingLanguage' - 'pendingMessage'
WHERE state ? 'awaitingLanguage';
