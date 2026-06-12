-- Intake forms: a public, tokened submit endpoint that files work items onto
-- a target item (tagged `intake`, state todo). The token is unguessable
-- (24 random bytes, hex); disabling or deleting the form kills the link.

CREATE TABLE IF NOT EXISTS forms (
  id           VARCHAR(64)  PRIMARY KEY,
  item_id      VARCHAR(32)  NOT NULL,
  name         VARCHAR(120) NOT NULL,
  public_token CHAR(48)     NOT NULL UNIQUE,
  enabled      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_forms_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);
