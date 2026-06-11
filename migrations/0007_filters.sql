-- Saved filters: named CQL queries per user, optionally shared with everyone.
-- Metadata, not lifecycle — a plain table, no events (same precedent as
-- projects/sprints). Deleting a user takes their filters with them.

CREATE TABLE IF NOT EXISTS filters (
  id         VARCHAR(64)   PRIMARY KEY,
  owner_id   VARCHAR(36)   NOT NULL,
  name       VARCHAR(120)  NOT NULL,
  cql        VARCHAR(2000) NOT NULL,
  shared     TINYINT(1)    NOT NULL DEFAULT 0,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_filters_owner_name (owner_id, name),
  CONSTRAINT fk_filters_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);
