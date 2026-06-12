-- Goals: align items to outcomes (Jira "Goals"). Progress is DERIVED at read
-- time from member items' spine positions — only membership is stored.

CREATE TABLE IF NOT EXISTS goals (
  id          VARCHAR(64)  PRIMARY KEY,
  title       VARCHAR(160) NOT NULL UNIQUE,
  target_date DATE         NULL,
  status      ENUM('active','done','cancelled') NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS item_goals (
  goal_id VARCHAR(64) NOT NULL,
  item_id VARCHAR(32) NOT NULL,
  PRIMARY KEY (goal_id, item_id),
  CONSTRAINT fk_ig_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
  CONSTRAINT fk_ig_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);
