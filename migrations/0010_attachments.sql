-- Attachments: metadata rows here, bytes on local disk under var/uploads/<id>
-- (served back through an authenticated route handler — never from /public).
-- Attached to an item, optionally narrowed to one of its work items.
-- Deleting an item cascades its rows; disk files are best-effort cleaned by
-- the delete route (dev-grade — orphaned files are harmless).

CREATE TABLE IF NOT EXISTS attachments (
  id         VARCHAR(64)  PRIMARY KEY,
  item_id    VARCHAR(32)  NOT NULL,
  wi_id      VARCHAR(32)  NULL,
  filename   VARCHAR(255) NOT NULL,
  mime       VARCHAR(128) NOT NULL,
  size       INT UNSIGNED NOT NULL,
  uploader   VARCHAR(128) NOT NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attachments_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  INDEX idx_attachments_item (item_id, wi_id)
);
