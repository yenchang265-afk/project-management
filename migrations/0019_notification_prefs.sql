-- Per-user notification preferences (Jira "notification scheme", simplified):
-- email delivery is OPT-IN per user and only active when the server has an
-- SMTP_URL configured. In-app notifications are unaffected.

CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id       VARCHAR(36) PRIMARY KEY,
  email_enabled TINYINT(1)  NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
