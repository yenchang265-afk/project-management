-- Phase 4: company → org → team hierarchy.
-- A single company (Cadence, the app root) contains multiple organizations;
-- each organization contains multiple teams (strict tree: one org per team).
-- Projects stay team-owned (project_teams); an org's projects are the derived
-- union of its teams' projects, so items/projects are untouched here.

CREATE TABLE IF NOT EXISTS organizations (
  id         VARCHAR(36)  PRIMARY KEY,
  name       VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE teams
  ADD COLUMN org_id VARCHAR(36) NULL,
  ADD CONSTRAINT fk_teams_org FOREIGN KEY (org_id) REFERENCES organizations(id);
