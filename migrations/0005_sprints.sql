-- First-class sprints: a per-team registry. Work items keep their free-text
-- `sprint` STRING; this table is the named/dated/stateful source of truth
-- the UI offers in pickers. Deleting a team takes its sprints with it.

CREATE TABLE IF NOT EXISTS sprints (
  id         VARCHAR(64)  PRIMARY KEY,
  team_id    VARCHAR(36)  NOT NULL,
  name       VARCHAR(120) NOT NULL,
  start_date DATE         NULL,
  end_date   DATE         NULL,
  state      ENUM('future','active','closed') NOT NULL DEFAULT 'future',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sprints_team_name (team_id, name),
  CONSTRAINT fk_sprints_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
);
