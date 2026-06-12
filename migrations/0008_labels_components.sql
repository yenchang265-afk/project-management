-- Labels (global) and components (per project): managed registries that feed
-- pickers/autocomplete. Work items keep storing plain strings in their events
-- (tags[] and component) — these tables are metadata, not lifecycle, mirroring
-- the sprints precedent.

CREATE TABLE IF NOT EXISTS labels (
  id         VARCHAR(64) PRIMARY KEY,
  name       VARCHAR(40) NOT NULL UNIQUE,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS components (
  id         VARCHAR(64) PRIMARY KEY,
  project_id VARCHAR(36) NOT NULL,
  name       VARCHAR(80) NOT NULL,
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_components_project_name (project_id, name),
  CONSTRAINT fk_components_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
