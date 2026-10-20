#!/usr/bin/env python3
"""Isolated release audit: delayed JSON bodies must not bypass session revocation."""
import argparse
import http.client
import json
from pathlib import Path
import secrets
import socket
import time
from urllib.parse import urlsplit
from merge_api import MergeTests, isolated_backend, ROOT, check


def delayed_request(base, client, method, path, body):
    url = urlsplit(base)
    encoded = json.dumps(body).encode()
    cookie = '; '.join(c.name + '=' + c.value for c in client.jar)
    conn = socket.create_connection((url.hostname, url.port), timeout=10)
    headers = (f'{method} /api/v1{path} HTTP/1.1\r\nHost: {url.netloc}\r\n'
               f'Origin: {base}\r\nCookie: {cookie}\r\nX-CSRF-Token: {client.csrf}\r\n'
               f'Idempotency-Key: {secrets.token_hex(16)}\r\nContent-Type: application/json\r\n'
               f'Content-Length: {len(encoded)}\r\nConnection: close\r\n\r\n')
    conn.sendall(headers.encode() + encoded[:1])
    # Server reads headers and authenticates, then waits for the remaining JSON.
    time.sleep(0.25)
    return conn, encoded[1:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, default=ROOT/'backend/target/debug/nolya-api')
    args = parser.parse_args()
    failures = 0
    for kind in ['profile', 'assessment']:
        with isolated_backend(args.binary.resolve(), 0) as (base, db):
            test = MergeTests(base, db)
            user = test.registered()
            if kind == 'profile':
                method, path, body = 'PATCH', '/me', {'display_name':'Mutation after revocation'}
            else:
                bank = user.request('GET','/self/questions')
                method, path, body = 'POST', '/self/assessments', {'version':bank['version'], 'answers':[{'question_id':q['id'],'choice':'A'} for q in bank['questions']]}
            conn, tail = delayed_request(base, user, method, path, body)
            user.request('POST','/auth/logout-all',statuses=(204,))
            check(test.scalar('SELECT count(*) FROM sessions WHERE user_id=?',(user.uid,)) == 0, 'Revocation fixture failed')
            conn.sendall(tail)
            response = http.client.HTTPResponse(conn)
            response.begin()
            status = response.status
            response.read()
            response.close()
            conn.close()
            mutated = (test.scalar('SELECT display_name FROM users WHERE id=?',(user.uid,)) == body.get('display_name') if kind == 'profile' else test.scalar('SELECT count(*) FROM assessments WHERE user_id=?',(user.uid,)) > 0)
            passed = status == 401 and not mutated
            print(('PASS' if passed else 'FAIL') + f': delayed {kind} after logout-all: HTTP {status}; mutated={mutated}', flush=True)
            failures += not passed
    return int(bool(failures))

if __name__ == '__main__':
    raise SystemExit(main())
