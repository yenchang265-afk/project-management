-- API tokens: bearer auth for integrations, alongside cookie sessions.
-- Only the SHA-256 hash is stored — the plaintext token is shown once at
-- creation and never again. Scope 'read' limits the token to GET requests.

CREATE TABLE IF NOT EXISTS api_tokens (
  id           VARCHAR(64) PRIMARY KEY,
  user_id      VARCHAR(36) NOT NULL,
  name         VARCHAR(80) NOT NULL,
  token_hash   CHAR(64)    NOT NULL UNIQUE,
  scope        ENUM('read','write') NOT NULL DEFAULT 'read',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP   NULL,
  CONSTRAINT fk_api_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
