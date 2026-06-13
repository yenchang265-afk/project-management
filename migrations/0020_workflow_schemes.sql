-- Workflow schemes (G-13): a per-project override of the engine's built-in
-- TRANSITIONS table. STATES and GATES stay engine-defined (the spine and its
-- gate conditions are core invariants); a scheme only re-wires the EDGES —
-- which moves exist, their roles, kind, reason rule, and gate attachment.
-- `transitions` is the validated TransitionDef[] (see src/lib/workflow.ts).
-- A project with workflow_scheme_id = NULL uses the engine default, so this
-- table is purely additive: behaviour is unchanged until a project opts in.

CREATE TABLE IF NOT EXISTS workflow_schemes (
  id          VARCHAR(36) PRIMARY KEY,
  name        VARCHAR(128) NOT NULL,
  transitions JSON         NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE projects
  ADD COLUMN workflow_scheme_id VARCHAR(36) NULL,
  ADD CONSTRAINT fk_projects_workflow_scheme
    FOREIGN KEY (workflow_scheme_id) REFERENCES workflow_schemes(id) ON DELETE SET NULL;
