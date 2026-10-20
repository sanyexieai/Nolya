#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo fmt --manifest-path backend/Cargo.toml -- --check
cargo test --manifest-path backend/Cargo.toml
cargo clippy --manifest-path backend/Cargo.toml --all-targets -- -D warnings
(cd frontend && { [[ -d node_modules ]] || npm ci; } && npm run build && npm test && npm run format:check)
cargo build --manifest-path backend/Cargo.toml
python3 tests/security_api.py
python3 tests/merge_api.py
python3 tests/auth_security_api.py
python3 tests/product_api.py
python3 tests/release_audit_api.py
python3 tests/config_api.py
python3 tests/restart_e2e.py
python3 scripts/ops/test_backup.py
python3 scripts/ops/test_api_restore.py
echo 'Build, unit/component, HTTP regressions, configuration, backup/restore and restart checks passed. Real browser and deployment acceptance remain separate; see tests/README.md.'
