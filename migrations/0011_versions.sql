-- Versions / releases: a per-project registry grouping items into a release.
-- items.fix_version is METADATA (a column, like project_id) — release
-- membership is not lifecycle, so no events. Releasing a version is guarded
-- in the route: every member item must be at or past `released` on the spine,
-- tying Jira's release concept to Cadence's release gate instead of
-- bypassing it.

CREATE TABLE IF NOT EXISTS versions (
  id           VARCHAR(64) PRIMARY KEY,
  project_id   VARCHAR(36) NOT NULL,
  name         VARCHAR(80) NOT NULL,
  release_date DATE        NULL,
  state        ENUM('unreleased','released','archived') NOT NULL DEFAULT 'unreleased',
  created_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_versions_project_name (project_id, name),
  CONSTRAINT fk_versions_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

ALTER TABLE items
  ADD COLUMN fix_version VARCHAR(64) NULL,
  ADD CONSTRAINT fk_items_fix_version FOREIGN KEY (fix_version) REFERENCES versions(id) ON DELETE SET NULL;
