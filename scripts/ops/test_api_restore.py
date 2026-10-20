#!/usr/bin/env python3
"""Restart the actual compiled API against an isolated backed-up database.
Never reads an operator's environment database or existing service.
"""
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
BINARY = ROOT / 'backend/target/debug/nolya-api'
SCRIPT = ROOT / 'scripts/ops/sqlite_backup.py'


def start(db, directory):
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    origin = f'http://127.0.0.1:{port}'
    env = dict(os.environ, NOLYA_ENV='development', NOLYA_BIND=f'127.0.0.1:{port}',
               NOLYA_DB_PATH=str(db), NOLYA_PUBLIC_ORIGIN=origin,
               NOLYA_ALLOWED_ORIGINS=origin, NOLYA_COOKIE_SECURE='false',
               NOLYA_STATIC_DIR=str(directory), RUST_LOG='error')
    process = subprocess.Popen([str(BINARY)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if process.poll() is not None:
                raise RuntimeError('isolated API exited before health check')
            try:
                with urllib.request.urlopen(origin + '/api/v1/health', timeout=0.2) as response:
                    if response.status == 200:
                        return process
            except (OSError, urllib.error.URLError):
                time.sleep(0.05)
        raise RuntimeError('isolated API health timeout')
    except BaseException:
        stop(process)
        raise


def stop(process):
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def main():
    if not BINARY.is_file():
        raise SystemExit('Run cargo build --manifest-path backend/Cargo.toml first.')
    with tempfile.TemporaryDirectory(prefix='nolya-restore-test-') as temp:
        directory = Path(temp)
        live = directory / 'source.sqlite'
        process = start(live, directory)
        try:
            with sqlite3.connect(live) as db:
                db.execute('CREATE TABLE ops_restore_sentinel(value TEXT NOT NULL)')
                db.execute("INSERT INTO ops_restore_sentinel VALUES ('synthetic-only')")
            result = subprocess.run(['python3', str(SCRIPT), 'backup', '--source', str(live), '--directory', str(directory / 'backups')], check=True, capture_output=True, text=True)
        finally:
            stop(process)
        backup = directory / 'backups' / result.stdout.strip()
        restored = directory / 'restored.sqlite'
        subprocess.run(['python3', str(SCRIPT), 'restore', '--source', str(backup), '--destination', str(restored)], check=True, capture_output=True)
        process = start(restored, directory)
        try:
            with sqlite3.connect(restored) as db:
                assert db.execute('SELECT value FROM ops_restore_sentinel').fetchone() == ('synthetic-only',)
                assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
        finally:
            stop(process)
    print('Isolated API database backup, restore, restart and sentinel persistence passed.')


if __name__ == '__main__':
    main()
