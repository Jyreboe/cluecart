#!/usr/bin/env bash
set -euo pipefail
# Restore only into a database with zero user accounts. Never overwrite local work.
backup=/workspace/.cluecart-backups/cluecart.dump
if [ ! -s "$backup" ]; then echo 'No local backup available.' >&2; exit 1; fi
count=$(docker exec cluecart-postgres psql -U cluecart -d cluecart -tAc 'SELECT (SELECT count(*) FROM organizations)+(SELECT count(*) FROM users)')
if [ "$count" != 0 ]; then echo 'Refusing to overwrite a database containing accounts or organizations.' >&2; exit 1; fi
docker exec -i cluecart-postgres pg_restore -U cluecart -d cluecart --data-only --single-transaction --exit-on-error < "$backup"
printf 'Database restored from local backup.\n'
