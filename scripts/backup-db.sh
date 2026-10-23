#!/usr/bin/env bash
set -euo pipefail
# A local, sensitive backup outside the checkout. Not an offsite backup policy.
umask 077
mkdir -p /workspace/.cluecart-backups
docker exec cluecart-postgres pg_dump -U cluecart -d cluecart --format=custom > /workspace/.cluecart-backups/cluecart.dump.pending
mv /workspace/.cluecart-backups/cluecart.dump.pending /workspace/.cluecart-backups/cluecart.dump
printf 'Local database backup saved outside the repository. Treat it as sensitive.\n'
