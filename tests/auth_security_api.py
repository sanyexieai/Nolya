#!/usr/bin/env python3
"""Credential lifecycle HTTP regressions using only owned loopback processes and disposable synthetic data."""
import argparse
import concurrent.futures
import copy
import hashlib
from pathlib import Path
import secrets
import sys
from e2e_api import Client
from merge_api import MergeTests, isolated_backend, check, ROOT

class AuthSecurityTests(MergeTests):
    def login(self, account, password=None):
        c = Client(self.base)
        s = c.request('POST', '/auth/login', {'username': account.username, 'password': password or account.password})
        c.csrf = s['csrf_token']
        return c

    def clone(self, c):
        other = Client(self.base)
        other.restore(copy.deepcopy(c.dump()))
        return other

    def code(self, c):
        return c.request('POST', '/auth/recovery-code', {'current_password': c.password})['recovery_code']

    def recover(self, c, code, password, statuses=(204,)):
        return Client(self.base).request('POST', '/auth/recover', {
            'username': c.username, 'recovery_code': code, 'new_password': password}, statuses=statuses)

    def test_password_change_revokes_sessions_and_recovery(self):
        c = self.registered()
        old = self.clone(c)
        other = self.login(c)
        code = self.code(c)
        password = secrets.token_urlsafe(24)
        c.request('POST', '/auth/password', {'current_password': 'incorrect secret', 'new_password': password}, statuses=(401,))
        c.request('POST', '/auth/password', {'current_password': c.password, 'new_password': 'short'}, statuses=(422,))
        c.request('POST', '/auth/password', {'current_password': c.password, 'new_password': password}, csrf=False, statuses=(403,))
        s = c.request('POST', '/auth/password', {'current_password': c.password, 'new_password': password})
        c.csrf = s['csrf_token']
        check(c.request('GET', '/session')['user']['id'] == c.uid, 'Password change lost account')
        for prior in [old, other]:
            check(prior.request('GET', '/session')['user'] is None, 'Old session remains authenticated')
        Client(self.base).request('POST', '/auth/login', {'username': c.username, 'password': c.password}, statuses=(401,))
        self.login(c, password)
        self.recover(c, code, secrets.token_urlsafe(24), statuses=(401,))
        check(self.scalar('SELECT recovery_code_hash FROM users WHERE id=?', (c.uid,)) is None, 'Old recovery code retained')

    def test_recovery_code_rotation_digest_and_no_export(self):
        c = self.registered()
        c.request('POST', '/auth/recovery-code', {'current_password': 'wrong password'}, statuses=(401,))
        first, second = self.code(c), self.code(c)
        check(first != second and len(second) == 64, 'Recovery code lacks fresh entropy')
        stored = self.scalar('SELECT recovery_code_hash FROM users WHERE id=?', (c.uid,))
        check(stored == hashlib.sha256(second.encode()).hexdigest(), 'Recovery secret not stored as digest')
        data = str(c.request('GET', '/me/export'))
        check(second not in data and stored not in data and 'password_hash' not in data, 'Export leaked secrets')
        self.recover(c, first, secrets.token_urlsafe(24), statuses=(401,))
        self.recover(c, second, secrets.token_urlsafe(24))

    def test_recovery_consumes_once_and_revokes_all_sessions(self):
        c = self.registered()
        other = self.login(c)
        code = self.code(c)
        password = secrets.token_urlsafe(24)
        self.recover(c, code, password)
        self.recover(c, code, secrets.token_urlsafe(24), statuses=(401,))
        for prior in [c, other]:
            check(prior.request('GET', '/session')['user'] is None, 'Recovery failed to revoke sessions')
        self.login(c, password)
        Client(self.base).request('POST', '/auth/login', {'username': c.username, 'password': c.password}, statuses=(401,))

    def test_recovery_preserves_guest_and_requires_origin_and_csrf(self):
        c = self.registered()
        code = self.code(c)
        guest = self.new()
        body = {'username': c.username, 'recovery_code': code, 'new_password': secrets.token_urlsafe(24)}
        Client(self.base).request('POST', '/auth/recover', body, origin='https://attacker.invalid', statuses=(403,))
        guest.request('POST', '/auth/recover', body, csrf=False, statuses=(403,))
        guest.request('POST', '/auth/recover', body, statuses=(204,))
        check(guest.request('GET', '/session')['user']['id'] == guest.uid, 'Recovery silently switched guest identity')

    def test_concurrent_recovery_only_one_wins(self):
        c = self.registered()
        code = self.code(c)
        passwords = [secrets.token_urlsafe(24) for _ in range(2)]
        def attempt(password):
            response = self.recover(c, code, password, statuses=(204,401))
            return response is None
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(attempt, passwords))
        check(sum(results) == 1, 'One-time code consumed more than once')
        self.login(c, passwords[results.index(True)])

    def test_logout_all_clears_every_session(self):
        c = self.registered()
        other = self.login(c)
        c.request('POST', '/auth/logout-all', statuses=(204,))
        for prior in [c, other]:
            check(prior.request('GET', '/session')['user'] is None, 'Logout-all left live session')
        check(self.scalar('SELECT count(*) FROM sessions WHERE user_id=?', (c.uid,)) == 0, 'Session rows remain')

    def test_account_deletion_requires_password_and_cleans_recovery(self):
        c = self.registered()
        self.code(c)
        other = self.login(c)
        c.request('DELETE', '/me', {'confirmation':'DELETE'}, statuses=(401,))
        c.request('DELETE', '/me', {'confirmation':'DELETE','password':'wrong password'}, statuses=(401,))
        check(c.request('GET', '/session')['user'] is not None, 'Rejected deletion mutated account')
        c.request('DELETE', '/me', {'confirmation':'DELETE','password':c.password}, statuses=(204,))
        check(other.request('GET', '/session')['user'] is None, 'Deletion retained session')
        check(self.scalar('SELECT count(*) FROM users WHERE id=?', (c.uid,)) == 0, 'Deleted account remains')
        check(not self.query('PRAGMA foreign_key_check'), 'Deletion broke references')
        guest = self.new()
        guest.request('DELETE','/me',{'confirmation':'DELETE'},statuses=(204,))

    def test_guest_cannot_manage_credentials(self):
        guest = self.new()
        guest.request('POST', '/auth/password', {'current_password':'irrelevant secret','new_password':secrets.token_urlsafe(24)}, statuses=(403,))
        guest.request('POST', '/auth/recovery-code', {'current_password':'irrelevant secret'}, statuses=(403,))

    def test_recovery_failure_rolls_back_and_code_can_retry(self):
        c = self.registered()
        code = self.code(c)
        password = secrets.token_urlsafe(24)
        self.execute("CREATE TRIGGER synthetic_recovery_failure BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END")
        self.recover(c, code, password, statuses=(500,))
        check(c.request('GET', '/session')['user']['id'] == c.uid, 'Failed recovery revoked session')
        self.login(c)
        self.execute('DROP TRIGGER synthetic_recovery_failure')
        self.recover(c, code, password)
        self.login(c, password)

    def test_security_headers_on_rejected_requests(self):
        import urllib.request
        import urllib.error
        request = urllib.request.Request(self.base+'/api/v1/auth/recover',data=b'{}',method='POST',headers={'Content-Type':'application/json','Origin':'https://attacker.invalid'})
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            response = error
        check(response.status == 403, 'Origin check missing')
        check(response.headers.get('Cache-Control') == 'no-store', 'Error responses can be cached')
        check(response.headers.get('X-Content-Type-Options') == 'nosniff', 'Error responses lack security headers')
        response.close()

    def test_recovery_throttles_and_does_not_enumerate_accounts(self):
        c = self.registered()
        code = secrets.token_hex(32)
        body = {'username':c.username, 'recovery_code':code,'new_password':secrets.token_urlsafe(24)}
        anon = Client(self.base)
        first = anon.request('POST','/auth/recover',body,statuses=(401,))
        missing = anon.request('POST','/auth/recover',dict(body,username='absent_account'),statuses=(401,))
        check(first == missing, 'Recovery errors enumerate usernames')
        for _ in range(4):
            anon.request('POST','/auth/recover',body,statuses=(401,))
        anon.request('POST','/auth/recover',body,statuses=(429,))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',type=Path,default=ROOT/'backend/target/debug/nolya-api')
    args = parser.parse_args()
    binary = args.binary.resolve()
    if not binary.is_file(): parser.error('Build backend first')
    failures = 0
    names = [name for name in AuthSecurityTests.__dict__ if name.startswith('test_')]
    for name in names:
        try:
            with isolated_backend(binary,0) as (base,db):
                getattr(AuthSecurityTests(base,db),name)()
            print('PASS:',name,flush=True)
        except Exception as exc:
            failures += 1
            print('FAIL:',name,type(exc).__name__,str(exc),flush=True)
    print(f'SUMMARY: {len(names)} cases, {failures} failures',flush=True)
    return int(bool(failures))
if __name__ == '__main__': sys.exit(main())
