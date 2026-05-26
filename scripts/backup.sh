#!/usr/bin/env bash
# Phase 5b — cron-friendly database backup.
#
# Usage:
#   DATABASE_URL=postgres://... ./scripts/backup.sh
#   # or as a cron:
#   #   0 2 * * * cd /srv/app && DATABASE_URL=$(cat .env.DATABASE_URL) ./scripts/backup.sh
#
# Writes a gzipped pg_dump to ./backups/YYYY-MM-DDTHH-MM.sql.gz.
# Exits non-zero on failure so cron can email/alert.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

DEST_DIR="${BACKUP_DIR:-backups}"
mkdir -p "$DEST_DIR"

STAMP="$(date -u +"%Y-%m-%dT%H-%M")"
OUT="$DEST_DIR/$STAMP.sql.gz"

pg_dump "$DATABASE_URL" | gzip > "$OUT"

# Verify the dump is non-empty.
if [[ ! -s "$OUT" ]]; then
  echo "backup produced an empty file: $OUT" >&2
  exit 1
fi

echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
