#!/usr/bin/env python3
"""Package source and optionally the built frontend, excluding all private/runtime data."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--include-web-build', action='store_true')
args = parser.parse_args()
output = args.output.resolve()
output.parent.mkdir(parents=True, exist_ok=True)
excluded = {'node_modules', 'target', '.git', 'data', 'artifacts', '__pycache__', '.venv', 'test-artifacts'}
manifest = []
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
if subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip():
    parser.error('Commit verified source before packaging; worktree must be clean')
tracked = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0'))
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.is_symlink():
            continue
        rel = path.relative_to(root)
        if rel.as_posix() not in tracked and not (args.include_web_build and rel.parts[:2] == ('frontend', 'dist')):
            continue
        if any(part in excluded for part in rel.parts):
            continue
        if 'dist' in rel.parts and not args.include_web_build:
            continue
        if path.name == '.env' or path.suffix in {'.sqlite', '.db', '.log', '.pyc', '.tsbuildinfo'} or path.name.endswith(('-wal', '-shm')):
            continue
        if path.resolve() == output or path.suffix == '.zip':
            continue
        content = path.read_bytes()
        archive.write(path, str(Path('nolya') / rel))
        manifest.append({'path': rel.as_posix(), 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    archive.writestr('nolya/BUILD.json', json.dumps({'version':'0.2.0','commit':commit,'acceptance':'candidate; real-browser gate pending'}))
    archive.writestr('nolya/SOURCE_MANIFEST.json', json.dumps(manifest, ensure_ascii=False, indent=2))
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
print(json.dumps({'file': str(output), 'files': len(manifest), 'bytes': output.stat().st_size, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
