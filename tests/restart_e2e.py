#!/usr/bin/env python3
"""Run the full synthetic HTTP workflow, actually restart, then verify persistence."""
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
ROOT=Path(__file__).resolve().parents[1]
binary=ROOT/'backend/target/debug/nolya-api'
with socket.socket() as s:
    s.bind(('127.0.0.1',0));port=s.getsockname()[1]
base=f'http://127.0.0.1:{port}'
with tempfile.TemporaryDirectory(prefix='nolya-restart-') as temp:
    temp=Path(temp);env=dict(os.environ,NOLYA_ENV='development',NOLYA_BIND=f'127.0.0.1:{port}',NOLYA_DB_PATH=str(temp/'synthetic.sqlite'),NOLYA_PUBLIC_ORIGIN=base,NOLYA_ALLOWED_ORIGINS=base,NOLYA_COOKIE_SECURE='false',RUST_LOG='warn')
    for resume in [False,True]:
        with (temp/'server.log').open('w') as log:
            proc=subprocess.Popen([str(binary)],cwd=ROOT,env=env,stdout=log,stderr=log)
            try:
                for _ in range(150):
                    if proc.poll() is not None:raise RuntimeError('Owned server exited before readiness')
                    try:
                        with urllib.request.urlopen(base+'/api/v1/health/ready',timeout=.5) as response:
                            if response.status==200:break
                    except (OSError,TimeoutError):pass
                    time.sleep(.05)
                else:raise RuntimeError('Owned server never became ready')
                command=[sys.executable,str(ROOT/'tests/e2e_api.py'),'--base',base,'--state',str(temp/'state.json')]
                if resume:command+=['--resume']
                subprocess.run(command,cwd=ROOT,check=True)
            finally:
                proc.terminate()
                try:proc.wait(timeout=10)
                except subprocess.TimeoutExpired:proc.kill();proc.wait();raise RuntimeError('Graceful shutdown exceeded deadline')
            if proc.returncode != 0:raise RuntimeError('SIGTERM shutdown did not complete cleanly')
print('PASS: full HTTP workflow, SIGTERM shutdown, real restart and persisted records')
