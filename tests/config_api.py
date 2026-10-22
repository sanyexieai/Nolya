#!/usr/bin/env python3
"""Validate fail-closed production configuration without starting any public service."""
import os
from pathlib import Path
import subprocess
import tempfile
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='nolya-config-') as temp:
    base=dict(os.environ,NOLYA_ENV='production',NOLYA_BIND='127.0.0.1:0',NOLYA_DB_PATH=str(Path(temp)/'must-not-exist.sqlite'),NOLYA_PUBLIC_ORIGIN='https://nolya.example.com',NOLYA_ALLOWED_ORIGINS='https://nolya.example.com',NOLYA_COOKIE_SECURE='true',NOLYA_STATIC_DIR=str(ROOT/'frontend/dist'))
    for change in [{'NOLYA_PUBLIC_ORIGIN':'http://nolya.example.com'},{'NOLYA_ALLOWED_ORIGINS':'https://*.example.com'},{'NOLYA_COOKIE_SECURE':'false'},{'NOLYA_COOKIE_SECURE':'yes'},{'NOLYA_PUBLIC_ORIGIN':'https://nolya.example.com/path'},{'NOLYA_PUBLIC_ORIGIN':'https://nolya.example.com#secret'},{'NOLYA_ALLOWED_ORIGINS':''},{'NOLYA_SESSION_DAYS':'91'},{'NOLYA_ENV':'prod'},{'NOLYA_STATIC_DIR':str(Path(temp)/'missing')}]:
        proc=subprocess.run([str(ROOT/'backend/target/debug/nolya-api')],env={**base,**change},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=5)
        assert proc.returncode!=0,'Unsafe configuration started'
        assert not Path(base['NOLYA_DB_PATH']).exists(),'Invalid config mutated database'
print('PASS: 10 invalid production configurations rejected before database creation')
