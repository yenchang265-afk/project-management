-- Runtime app user with least-privilege grants.
-- The app's DATABASE_URL user gets NO UPDATE/DELETE on `events`, enforcing the
-- append-only event log at the grant level (see CLAUDE.md / src/server/db.ts).
--
-- Run as root AFTER `npm run db:migrate` (tables must exist for table-level grants).
-- Re-run whenever a migration adds a table (add a matching GRANT below), or after
-- recreating the Docker volume:
--
--   docker compose exec db mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" cadence < scripts/db-grants.sql
--
-- Native MariaDB: replace 'cadence'@'%' with 'cadence'@'localhost' and adjust the
-- password to match your .env.local DATABASE_URL.

CREATE USER IF NOT EXISTS 'cadence'@'%' IDENTIFIED BY 'cadence_dev_pw';

-- Append-only: the event log can be read and extended, never rewritten.
GRANT SELECT, INSERT ON cadence.events TO 'cadence'@'%';

-- Everything else: normal DML, no DDL.
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.announcements TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.items TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.notifications TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.organizations TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.project_teams TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.projects TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.sessions TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.sprints TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.team_members TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.teams TO 'cadence'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON cadence.users TO 'cadence'@'%';

GRANT SELECT ON cadence.schema_migrations TO 'cadence'@'%';

FLUSH PRIVILEGES;
