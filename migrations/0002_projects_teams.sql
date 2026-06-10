-- Phase 2: project-based hierarchy.
-- projects own items; teams own projects (M:N); users belong to teams (M:N).

CREATE TABLE IF NOT EXISTS projects (
  id          VARCHAR(36)  PRIMARY KEY,
  `key`       VARCHAR(16)  NOT NULL UNIQUE,
  name        VARCHAR(128) NOT NULL,
  description VARCHAR(500) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS teams (
  id         VARCHAR(36)  PRIMARY KEY,
  name       VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_teams (
  project_id VARCHAR(36) NOT NULL,
  team_id    VARCHAR(36) NOT NULL,
  PRIMARY KEY (project_id, team_id),
  CONSTRAINT fk_pt_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_team    FOREIGN KEY (team_id)    REFERENCES teams(id)    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_tm_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_tm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE items
  ADD COLUMN project_id VARCHAR(36) NULL,
  ADD CONSTRAINT fk_items_project FOREIGN KEY (project_id) REFERENCES projects(id);
