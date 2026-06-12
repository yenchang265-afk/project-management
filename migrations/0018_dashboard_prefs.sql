-- Customizable dashboard (gadgets v1): each user stores an ordered list of
-- gadget kinds as JSON. No row = the built-in default layout. The gadget
-- registry (which kinds exist, how they render) lives in the client.

CREATE TABLE IF NOT EXISTS dashboard_prefs (
  user_id    VARCHAR(36) PRIMARY KEY,
  gadgets    TEXT        NOT NULL,
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dash_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
