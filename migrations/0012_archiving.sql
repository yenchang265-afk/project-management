-- Archiving: metadata timestamp on items (a column, not an event — archived
-- is visibility, not lifecycle; the event log stays untouched and the item
-- can come back exactly as it was). Archived items are hidden from boards,
-- lists, and pickers by default; the list view can opt in to showing them.

ALTER TABLE items ADD COLUMN archived_at TIMESTAMP NULL;
