#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
command -v cargo >/dev/null || { echo 'Add Rust/Cargo to PATH first.' >&2; exit 1; }
if [[ -f .env ]]; then set -a; source .env; set +a; fi
export NOLYA_PUBLIC_ORIGIN="${NOLYA_PUBLIC_ORIGIN:-http://127.0.0.1:5173}"
mkdir -p data
[[ -d frontend/node_modules ]] || (cd frontend && npm ci)
cargo run --manifest-path backend/Cargo.toml --bin nolya-api &
backend_pid=$!
trap 'kill "$backend_pid" 2>/dev/null || true' EXIT INT TERM
(cd frontend && npm run dev)
