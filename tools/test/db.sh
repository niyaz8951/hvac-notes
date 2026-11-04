#!/bin/bash
# Local database test (test harness only, not part of the delivery).
# A throw-away Postgres stands in for Supabase: dame-hub's stub, the core SQL, the staging seed,
# the tile registered as the owner does it in the admin page, then this tile's SQL, its tests and the security check.
# Needs psql and a running Postgres (PGARGS, default "-h /tmp -p 5499 -U postgres -d hvac"), and dame-hub cloned next to
# this repo (DAME, default ../dame-hub) or anywhere (DAME=/path/to/dame-hub).
set -e
cd "$(dirname "$0")/../.."
: "${PGARGS:=-h /tmp -p 5499 -U postgres -d hvac}"
: "${DAME:=../dame-hub}"
DB=$(echo "$PGARGS" | sed -n 's/.*-d \([^ ]*\).*/\1/p')
ADMIN=$(echo "$PGARGS" | sed "s/-d $DB/-d postgres/")
q() { psql $PGARGS -q -v ON_ERROR_STOP=1 "$@"; }
psql $ADMIN -qc "drop database if exists $DB" ; psql $ADMIN -qc "create database $DB"
q -f "$DAME/tools/test/supabase-stub.sql"
for f in "$DAME"/db/core/0*.sql; do q -f "$f" > /dev/null; done
q -f "$DAME/db/core/seed-staging.sql" > /dev/null
# The owner registers the tile in the admin page (Tiles > New tile): id, name, the right 'edit', switched on.
q -c "insert into core.tiles (id, name, tagline, icon, sort_order, enabled, rights) values ('hvac-notes', 'HVAC Notes', 'Product and engineering notes', 'book', 20, true, array['edit'])" > /dev/null
q -f db/hvac_notes/001_init.sql > /dev/null
q -f db/hvac_notes/tests.sql 2>&1 | grep -E 'ERROR|PASSED|expected|CONTEXT' || true
q -f tools/test/seed-local.sql > /dev/null
echo "security_check:"; psql $PGARGS -At -c "select * from core.security_check()"
