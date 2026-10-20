#!/usr/bin/env bash
# Reproducible browser acceptance against disposable synthetic data only.
set -euo pipefail
cd "$(dirname "$0")/.."
qa=$(mktemp -d "${TMPDIR:-/tmp}/nolya-browser.XXXXXX")
pid=''
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf "$qa"
}
trap cleanup EXIT INT TERM
npm --prefix frontend run build
cargo build --manifest-path backend/Cargo.toml
export NOLYA_ENV=development
export NOLYA_BIND=127.0.0.1:3019
export NOLYA_DB_PATH="$qa/test.sqlite"
export NOLYA_STATIC_DIR=frontend/dist
export NOLYA_PUBLIC_ORIGIN=http://127.0.0.1:3019
export NOLYA_ALLOWED_ORIGINS=http://127.0.0.1:3019
export NOLYA_COOKIE_SECURE=false
export NOLYA_TEST_BASE=http://127.0.0.1:3019
export NOLYA_SYNTHETIC_DB=1
backend/target/debug/nolya-api >"$qa/server.log" 2>&1 &
pid=$!
# Verify our process survived startup, not just that an unrelated service exists.
ready=0
for _ in $(seq 1 100); do
  if ! kill -0 "$pid" 2>/dev/null; then cat "$qa/server.log"; exit 1; fi
  if curl --fail --silent "$NOLYA_TEST_BASE/api/v1/session" >/dev/null; then ready=1; break; fi
  sleep .1
done
[[ "$ready" == 1 ]] || { cat "$qa/server.log"; exit 1; }
kill -0 "$pid"
node tests/browser_smoke.cjs
