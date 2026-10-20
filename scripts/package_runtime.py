#!/usr/bin/env python3
"""Build a data-free Linux runtime ZIP from an already verified release binary/web build."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
binary=ROOT/'backend/target/release/nolya-api';web=ROOT/'frontend/dist'
if not binary.is_file() or not (web/'index.html').is_file():p.error('Build locked release backend and production frontend first')
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
if subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip():p.error('Commit verified source before packaging; worktree must be clean')
output=args.output.resolve();output.parent.mkdir(parents=True,exist_ok=True)
manifest=[]
start='''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
export NOLYA_ENV="${NOLYA_ENV:-development}"
export NOLYA_BIND="${NOLYA_BIND:-127.0.0.1:3000}"
export NOLYA_DB_PATH="${NOLYA_DB_PATH:-data/nolya.sqlite}"
export NOLYA_STATIC_DIR="$PWD/frontend/dist"
export NOLYA_PUBLIC_ORIGIN="${NOLYA_PUBLIC_ORIGIN:-http://127.0.0.1:3000}"
export NOLYA_ALLOWED_ORIGINS="${NOLYA_ALLOWED_ORIGINS:-http://127.0.0.1:3000,http://localhost:3000}"
export NOLYA_COOKIE_SECURE="${NOLYA_COOKIE_SECURE:-false}"
mkdir -p "$(dirname "$NOLYA_DB_PATH")"
exec ./nolya-api
'''
with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
    def add(name,data,executable=False):
        info=zipfile.ZipInfo('nolya-linux-x64/'+name);info.external_attr=(0o100755 if executable else 0o100644)<<16;info.compress_type=zipfile.ZIP_DEFLATED
        archive.writestr(info,data);manifest.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    add('nolya-api',binary.read_bytes(),True);add('start.sh',start.encode(),True)
    for file in sorted(web.rglob('*')):
        if file.is_file() and not file.is_symlink():add('frontend/dist/'+file.relative_to(web).as_posix(),file.read_bytes())
    for file in sorted((ROOT/'docs').glob('*.md')):add('docs/'+file.name,file.read_bytes())
    add('README.md',('''# Nolya 0.2 Linux x64 产品化候选

解压后运行 bash start.sh，打开 http://127.0.0.1:3000 。不需要安装 Rust/Node。需要 Linux x86_64，glibc 2.34+。

默认仅本机访问。数据写入 data/nolya.sqlite，不要把数据文件发给其他人。关闭终端会停止服务。保留数据目录可在重启后继续使用。

本包未部署公网。列明范围的托管 Chromium 自动化验收通过，但不等于全面可访问性或生产部署验收。详情见 docs/PRODUCT_READINESS.md 和 RELEASE_VERIFICATION.md。生产模式需明确配置 HTTPS/Origin/Secure Cookie，部署需按 OPERATIONS.md 单独验收。

源码提交：'''+commit+'\n').encode())
    for file in sorted((ROOT/'scripts/ops').glob('*.py')):
        if file.name=='sqlite_backup.py':add('scripts/ops/'+file.name,file.read_bytes())
    add('BUILD.json',json.dumps({'version':'0.2.0','commit':commit,'platform':'linux-x86_64','acceptance':'release candidate; hosted Chromium scope passed; operator production acceptance pending'},indent=2).encode())
    archive.writestr('nolya-linux-x64/MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
with zipfile.ZipFile(output) as archive:assert archive.testzip() is None
print(json.dumps({'file':str(output),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'commit':commit}))
