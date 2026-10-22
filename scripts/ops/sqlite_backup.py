#!/usr/bin/env python3
"""Consistent SQLite snapshots. Never restores over an existing path.
Run as the database service account. Backup directories must be private.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
from urllib.parse import quote


def private_dir(path):
    path = Path(path).absolute()
    if path.is_symlink():
        raise ValueError("directory must not be a symlink")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.stat().st_mode & 0o077:
        raise ValueError("directory must have mode 0700 (not group/world accessible)")
    return path


def read_db(path):
    path = Path(path).absolute()
    if path.is_symlink() or not path.is_file():
        raise ValueError("source must be an existing regular database, not a symlink")
    return sqlite3.connect("file:" + quote(str(path), safe="/") + "?mode=ro", uri=True, timeout=10)


def check(db):
    if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise ValueError("database integrity check failed")
    if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise ValueError("database foreign-key check failed")


def snapshot(source, destination, timeout=60):
    destination = Path(destination).absolute()
    directory = private_dir(destination.parent)
    if any(Path(str(destination) + suffix).exists() or Path(str(destination) + suffix).is_symlink()
           for suffix in ("", "-wal", "-shm", "-journal")):
        raise ValueError("destination already exists; overwriting is forbidden")
    fd, temporary = tempfile.mkstemp(prefix=".snapshot-", dir=directory)
    os.close(fd)
    started = time.monotonic()
    def progress(status, remaining, total):
        if time.monotonic() - started > timeout:
            raise TimeoutError("snapshot exceeded time budget")
    try:
        with closing(read_db(source)) as src, closing(sqlite3.connect(temporary)) as dst:
            src.backup(dst, pages=128, progress=progress, sleep=0.05)
            check(dst)
            dst.execute("PRAGMA journal_mode=DELETE")
        with open(temporary, "rb") as file:
            os.fsync(file.fileno())
        # Hard-link publication is atomic and cannot clobber an existing destination.
        os.link(temporary, destination)
        dirfd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dirfd)
        finally:
            os.close(dirfd)
    finally:
        os.unlink(temporary)
    return destination


def digest(path):
    with open(path, "rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def verify(source):
    source = Path(source)
    manifest = source.with_suffix(source.suffix + ".json")
    if manifest.is_symlink():
        raise ValueError("manifest must not be a symlink")
    if source.is_symlink() or not source.is_file():
        raise ValueError("source must be a regular backup file")
    metadata = json.loads(manifest.read_text())
    if metadata.get("sha256") != digest(source):
        raise ValueError("backup checksum mismatch")
    with closing(read_db(source)) as db:
        check(db)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    backup = sub.add_parser("backup")
    backup.add_argument("--source", required=True)
    backup.add_argument("--directory", required=True)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--source", required=True)
    restore = sub.add_parser("restore")
    restore.add_argument("--source", required=True)
    restore.add_argument("--destination", required=True, help="new path in a private directory only")
    retention = sub.add_parser("retention", help="list expired backup pairs; dry-run unless --apply")
    retention.add_argument("--directory", required=True)
    retention.add_argument("--days", type=int, default=30)
    retention.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "backup":
        directory = private_dir(args.directory)
        name = time.strftime("nolya-%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + os.urandom(4).hex() + ".sqlite"
        target = snapshot(args.source, directory / name)
        with open(str(target) + ".json", "x", encoding="utf-8") as manifest:
            json.dump({"version": 1, "sha256": digest(target), "created_unix": time.time()}, manifest)
            manifest.flush()
            os.fsync(manifest.fileno())
        print(target.name)  # No records, credentials, or database contents in output.
    elif args.command == "verify":
        verify(args.source)
        print("Backup checksum, integrity, and foreign keys verified.")
    elif args.command == "restore":
        verify(args.source)
        snapshot(args.source, args.destination)
        print("Restored to a new database; existing databases were not modified.")
    else:
        if args.days < 1:
            raise ValueError("retention days must be positive")
        directory = private_dir(args.directory)
        backups = sorted(directory.glob("nolya-*.sqlite"), key=lambda p: p.stat().st_mtime, reverse=True)
        # Keep at least the latest snapshot even if every snapshot is old.
        for backup in backups[1:]:
            if backup.is_symlink():
                continue
            metadata = verify(backup)  # Never delete unverified or partial snapshots.
            if metadata["created_unix"] < time.time() - args.days * 86400:
                print(("DELETE " if args.apply else "WOULD DELETE ") + backup.name)
                if args.apply:
                    backup.unlink()
                    backup.with_suffix(backup.suffix + ".json").unlink()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, sqlite3.Error, TimeoutError, KeyError) as error:
        # Do not emit raw SQLite errors: they can contain schema/data or sensitive paths.
        print("Operation failed safely (" + type(error).__name__ + "). Check paths, private permissions, checksum and database health.", file=sys.stderr)
        sys.exit(1)
