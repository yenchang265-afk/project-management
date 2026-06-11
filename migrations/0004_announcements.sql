-- Phase 5: announcements, scoped to a level of the hierarchy.
-- scope_type = 'company' (scope_id NULL, visible to everyone),
--            = 'org'  (scope_id = organizations.id, visible to that org's members),
--            = 'team' (scope_id = teams.id, visible to that team's members).
-- scope_id is polymorphic so no FK; orphans (after org/team delete) are filtered
-- out at read time against the live structure.

CREATE TABLE IF NOT EXISTS announcements (
  id         VARCHAR(36)   PRIMARY KEY,
  scope_type ENUM('company','org','team') NOT NULL,
  scope_id   VARCHAR(36)   NULL,
  title      VARCHAR(160)  NOT NULL,
  body       VARCHAR(2000) NULL,
  author     VARCHAR(128)  NOT NULL,
  created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ann_scope ON announcements (scope_type, scope_id);
