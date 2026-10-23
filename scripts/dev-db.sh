#!/usr/bin/env bash
set -euo pipefail
# Local development only. Loopback port and Docker volume, never production.
if docker container inspect cluecart-postgres >/dev/null 2>&1; then
  if [ "$(docker inspect --format '{{.State.Running}}' cluecart-postgres)" != true ]; then
    docker start cluecart-postgres >/dev/null
  fi
else
  docker run -d --name cluecart-postgres \
    -e POSTGRES_USER=cluecart -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=cluecart \
    -p 127.0.0.1:5432:5432 -v cluecart-postgres:/var/lib/postgresql/data \
    postgres:17@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe >/dev/null
fi
for attempt in {1..30}; do
  if docker exec cluecart-postgres pg_isready -U cluecart >/dev/null 2>&1; then break; fi
  if [ "$attempt" -eq 30 ]; then echo 'PostgreSQL did not become ready.' >&2; exit 1; fi
  sleep 1
done
for database in cluecart_test cluecart_e2e; do
  exists=$(docker exec cluecart-postgres psql -U cluecart -d cluecart -tAc "SELECT 1 FROM pg_database WHERE datname='$database'")
  if [ "$exists" != 1 ]; then docker exec cluecart-postgres createdb -U cluecart "$database"; fi
done
printf 'Local PostgreSQL and isolated test databases are ready.\n'
