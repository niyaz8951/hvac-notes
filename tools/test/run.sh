#!/bin/bash
# Local test of the whole tile (test harness only): database, functions, bucket policies, Publish page and reader.
# Needs: psql + a running Postgres 16 (PGARGS, default "-h /tmp -p 5499 -U postgres -d hvac"), node 20+, zip,
# Playwright (PLAYWRIGHT_ROOT = its node_modules) and Chrome (CHROME), and dame-hub cloned next to this repo (or DAME=...).
# Uses only the invented library in tools/test/fixture/.
set -e
cd "$(dirname "$0")/../.."
: "${DAME:=../dame-hub}"; export DAME
: "${PGARGS:=-h /tmp -p 5499 -U postgres -d hvac}"; export PGARGS
TMP=$(mktemp -d); export STORE=$TMP
echo "== expression evaluator"; node tools/test/expr.test.mjs
echo "== code rules"; bash tools/test/static.sh
echo "== database"; bash tools/test/db.sh
echo "== page check on the invented library"; node tools/lint.mjs tools/test/fixture/src
(cd tools/test/fixture && zip -qr "$TMP/fixture.zip" src)
node tools/test/mock.mjs 8080 > "$TMP/mock.log" 2>&1 & MOCK=$!
trap 'kill $MOCK 2>/dev/null; rm -rf "$TMP"' EXIT
sleep 1
echo "== browser"; FIXTURE="$TMP/fixture.zip" node tools/test/e2e.mjs
