-- Backfill attachments.uploader from user display-name to user ID.
-- Previous code stored user.name (not unique); new code stores user.id.
-- Rows already holding a UUID (from after the fix) match no user.name and
-- are left untouched by the WHERE clause.
UPDATE attachments a
  INNER JOIN users u ON u.name = a.uploader
  SET a.uploader = u.id
  WHERE a.uploader NOT REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
