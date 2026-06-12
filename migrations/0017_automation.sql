-- Automation rules: subscribe to the same event stream commands append to.
-- trigger_kind = event type; cql = optional condition over the triggering
-- work item; actions = JSON array executed through the NORMAL command path
-- (rules can't bypass flows or gates). Events appended by automation carry
-- actor 'automation:…' and never re-trigger rules (loop prevention).

CREATE TABLE IF NOT EXISTS automation_rules (
  id           VARCHAR(64)   PRIMARY KEY,
  name         VARCHAR(120)  NOT NULL UNIQUE,
  trigger_kind VARCHAR(32)   NOT NULL,
  cql          VARCHAR(2000) NULL,
  actions      TEXT          NOT NULL,
  enabled      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rule_id VARCHAR(64)  NOT NULL,
  event_id VARCHAR(40) NOT NULL,
  ok      TINYINT(1)   NOT NULL,
  detail  VARCHAR(500) NULL,
  at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_runs_rule (rule_id, at)
);
