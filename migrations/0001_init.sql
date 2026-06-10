-- Phase 1 schema: items baseline + append-only events + auth.
-- MariaDB only — no Postgres-specific SQL (see CLAUDE.md).

CREATE TABLE IF NOT EXISTS items (
  id           VARCHAR(32)  PRIMARY KEY,
  title        VARCHAR(255) NOT NULL,
  area         VARCHAR(64)  NOT NULL,
  priority     ENUM('High','Medium','Low') NOT NULL,
  parent       VARCHAR(32)  NULL,
  type         VARCHAR(16)  NOT NULL,
  stakeholders JSON         NOT NULL,
  work_items   JSON         NOT NULL,
  plan         JSON         NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_items_parent FOREIGN KEY (parent) REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS events (
  seq      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  id       VARCHAR(40)  NOT NULL UNIQUE,
  item_id  VARCHAR(32)  NOT NULL,
  type     VARCHAR(32)  NOT NULL,
  actor    VARCHAR(128) NOT NULL,
  role     ENUM('PM','Dev') NOT NULL,
  ts       BIGINT       NOT NULL,
  payload  JSON         NOT NULL,
  CONSTRAINT fk_events_item FOREIGN KEY (item_id) REFERENCES items(id),
  INDEX idx_events_item_ts (item_id, ts, seq)
);

CREATE TABLE IF NOT EXISTS users (
  id            VARCHAR(36)  PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  name          VARCHAR(128) NOT NULL,
  role          ENUM('PM','Dev') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64)    PRIMARY KEY,
  user_id    VARCHAR(36) NOT NULL,
  expires_at TIMESTAMP   NOT NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_sessions_expiry (expires_at)
);
