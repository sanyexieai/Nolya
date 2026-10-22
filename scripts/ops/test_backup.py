#!/usr/bin/env python3
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('sqlite_backup.py')
spec = importlib.util.spec_from_file_location('backup', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupTests(unittest.TestCase):
    def test_live_wal_snapshot_restore_and_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            live = root / 'live.sqlite'
            with sqlite3.connect(live) as db:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE records(id INTEGER PRIMARY KEY, value TEXT)')
                db.execute("INSERT INTO records(value) VALUES ('private test value')")
                db.commit()
                backup_dir = root / 'backups'
                result = subprocess.run(['python3', str(SCRIPT), 'backup', '--source', str(live), '--directory', str(backup_dir)], capture_output=True, text=True, check=True)
                snapshot = backup_dir / result.stdout.strip()
                self.assertEqual(snapshot.stat().st_mode & 0o777, 0o600)
                self.assertEqual(backup_dir.stat().st_mode & 0o777, 0o700)
                module.verify(snapshot)
                restored = root / 'restored.sqlite'
                subprocess.run(['python3', str(SCRIPT), 'restore', '--source', str(snapshot), '--destination', str(restored)], check=True, capture_output=True)
                with sqlite3.connect(restored) as reopened:
                    self.assertEqual(reopened.execute('SELECT count(*) FROM records').fetchone()[0], 1)
                    reopened.execute("INSERT INTO records(value) VALUES ('restart write')")
                with self.assertRaises(ValueError):
                    module.snapshot(snapshot, live)
                self.assertEqual(db.execute('SELECT count(*) FROM records').fetchone()[0], 1)
                with open(snapshot, 'ab') as file:
                    file.write(b'corruption')
                with self.assertRaises(ValueError):
                    module.verify(snapshot)

    def test_missing_source_symlinks_and_public_directory_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                module.snapshot(root / 'missing.sqlite', root / 'new.sqlite')
            self.assertFalse((root / 'missing.sqlite').exists())
            target = root / 'target'
            target.touch()
            link = root / 'link'
            link.symlink_to(target)
            with self.assertRaises(ValueError):
                module.read_db(link)
            root.chmod(0o755)
            with self.assertRaises(ValueError):
                module.private_dir(root)

    def test_retention_dry_run_keeps_latest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source.sqlite'
            with sqlite3.connect(source) as db:
                db.execute('CREATE TABLE test(id INTEGER PRIMARY KEY)')
            backups = root / 'backups'
            for _ in range(2):
                subprocess.run(['python3', str(SCRIPT), 'backup', '--source', str(source), '--directory', str(backups)], check=True, capture_output=True)
            for manifest in backups.glob('*.json'):
                data = json.loads(manifest.read_text())
                data['created_unix'] = 1
                manifest.write_text(json.dumps(data))
            command = ['python3', str(SCRIPT), 'retention', '--directory', str(backups), '--days', '1']
            result = subprocess.run(command, check=True, capture_output=True, text=True)
            self.assertEqual(result.stdout.count('WOULD DELETE'), 1)
            self.assertEqual(len(list(backups.glob('*.sqlite'))), 2)
            subprocess.run(command + ['--apply'], check=True, capture_output=True)
            self.assertEqual(len(list(backups.glob('*.sqlite'))), 1)


if __name__ == '__main__':
    unittest.main()
