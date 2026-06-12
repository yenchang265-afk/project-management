-- Custom-field DEFINITIONS: which keys exist, their kind, and (for selects)
-- their options. VALUES keep traveling per-key in WI_UPDATE events
-- (WiPatchWire.customFields) — defs only drive the drawer's typed inputs.
-- scope '' = global (a sentinel instead of NULL keeps the UNIQUE key strict;
-- MariaDB UNIQUE treats NULLs as distinct). No FK for the same reason —
-- the repo validates project existence on insert.

CREATE TABLE IF NOT EXISTS field_defs (
  id         VARCHAR(96)  PRIMARY KEY,
  scope      VARCHAR(36)  NOT NULL DEFAULT '',
  `key`      VARCHAR(64)  NOT NULL,
  name       VARCHAR(80)  NOT NULL,
  kind       ENUM('text','number','date','select') NOT NULL,
  options    TEXT         NULL,
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_field_defs_scope_key (scope, `key`)
);
