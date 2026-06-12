-- Webhooks: fire-and-forget POSTs after an event is appended. The payload is
-- HMAC-signed with the per-hook secret (shown once at creation). `kinds` is a
-- comma list of event types ('*' = all). Ten consecutive failures disable the
-- hook (dead-letter flag) until a PM re-creates it.

CREATE TABLE IF NOT EXISTS webhooks (
  id         VARCHAR(64)  PRIMARY KEY,
  url        VARCHAR(500) NOT NULL,
  kinds      VARCHAR(500) NOT NULL DEFAULT '*',
  secret     VARCHAR(128) NOT NULL,
  failures   INT UNSIGNED NOT NULL DEFAULT 0,
  disabled   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
