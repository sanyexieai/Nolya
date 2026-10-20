#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
if ! command -v cargo >/dev/null 2>&1; then
  echo 'Rust/Cargo is required. Install stable Rust from https://rustup.rs and add cargo to PATH.' >&2
  exit 1
fi
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
if [[ ! -f frontend/dist/index.html ]]; then
  echo 'Building frontend...'
  (cd frontend && npm ci && npm run build)
fi
mkdir -p data
exec cargo run --manifest-path backend/Cargo.toml --bin nolya-api
