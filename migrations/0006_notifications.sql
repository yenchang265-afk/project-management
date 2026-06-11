-- Notifications: best-effort fan-out for watchers + @mentions.
-- item_id has NO FK on purpose — notifications outlive item lifecycle metadata
-- and must never block item writes. MariaDB only (see CLAUDE.md).

CREATE TABLE IF NOT EXISTS notifications (
  id         VARCHAR(64)  PRIMARY KEY,
  user_id    VARCHAR(36)  NOT NULL,
  item_id    VARCHAR(32)  NULL,
  kind       VARCHAR(32)  NOT NULL,
  message    VARCHAR(300) NOT NULL,
  read_at    TIMESTAMP    NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notifications_user_read (user_id, read_at)
);
