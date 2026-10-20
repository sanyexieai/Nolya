#!/usr/bin/env python3
"""Focused adversarial HTTP regressions using ONLY a new disposable local database.

This runner starts its own local backend subprocess, creates synthetic identities,
mutates synthetic fixture rows, and permanently deletes some synthetic accounts.
It accepts neither an external URL nor an existing database. Never adapt this to
run against real user data. Generated credentials, server logs and database files
remain in a temporary directory and are removed when the runner exits.

Build first: cargo build --manifest-path backend/Cargo.toml
Run: python3 tests/security_api.py --port 3011
The HTTP server and test client run within the same process namespace.
"""
import argparse
import concurrent.futures
import http.cookiejar
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from e2e_api import Client, hidden

ROOT = Path(__file__).resolve().parents[1]


def run_suite(BASE, DB):
    failures=[]
    def test(name, fn):
        try:
            fn(); print('PASS:',name,flush=True)
        except Exception as e:
            failures.append(name); print('FAIL:',name,type(e).__name__,str(e),flush=True)
    def new():
        c=Client(BASE); c.guest(); return c
    def assess(c, choice='A'):
        b=c.request('GET','/self/questions'); return c.request('POST','/self/assessments',{'version':b['version'],'answers':[{'question_id':q['id'],'choice':choice} for q in b['questions']]})
    def reply(c, t):
        s=c.request('POST','/invites/'+t+'/start',{'consent':True}); c.request('POST','/invites/'+t+'/responses',{'session_id':s['session_id'],'answers':[{'question_id':q['id'],'choice':'A'} for q in s['questions']]}); return s

    def private_reads():
        c=Client(BASE)
        for p in ['/self/latest','/mirror','/journal','/solo','/space','/me/export','/invites','/guesses']:
            c.request('GET',p,statuses=(401,))
    test('private routes require session',private_reads)
    a=new(); b=new(); outsider=new(); ar=assess(a); br=assess(b)
    def ownership():
        b.request('GET','/mirror?self_assessment_id='+ar['id'],statuses=(404,))
        b.request('POST','/invites',{'self_assessment_id':ar['id']},statuses=(404,))
        b.request('POST','/guesses',{'source_type':'self','answer_id':ar['answers'][0]['id']},statuses=(404,422))
        b.request('POST','/self/assessments/'+ar['id']+'/feedback',{'rating':'very_like'},statuses=(404,))
    test('cross-owner private references denied',ownership)
    def csrf():
        a.request('PATCH','/me',{'display_name':'x'},csrf=False,statuses=(403,))
        a.request('PATCH','/me',{'display_name':'x'},origin='https://untrusted.invalid',statuses=(403,))
        a.request('POST','/auth/login',{'username':'security_nonexistent','password':'test-only-never-real'},csrf=False,statuses=(403,))
    test('CSRF and Origin required including current-session login',csrf)
    def validation():
        bank=a.request('GET','/self/questions'); body={'version':bank['version'],'answers':[{'question_id':q['id'],'choice':'A'} for q in bank['questions']]}
        dup=json.loads(json.dumps(body)); dup['answers'][-1]=dup['answers'][0]; a.request('POST','/self/assessments',dup,statuses=(400,422))
        ext=json.loads(json.dumps(body)); ext['answers'][0]['owner_id']='invented'; a.request('POST','/self/assessments',ext,statuses=(400,422))
        bad=json.loads(json.dumps(body)); bad['version']='unknown'; a.request('POST','/self/assessments',bad,statuses=(400,409,422))
        a.request('PATCH','/me',{'display_name':'x'*40000},statuses=(413,))
        with sqlite3.connect(DB) as db: db.execute('UPDATE assessments SET version=? WHERE id=?',('unsupported-bank',ar['id']))
        a.request('POST','/guesses',{'source_type':'self','answer_id':ar['answers'][2]['id']},statuses=(404,409,422))
        with sqlite3.connect(DB) as db: db.execute('UPDATE assessments SET version=? WHERE id=?',(ar['version'],ar['id']))
    test('duplicate/extra/version/oversize inputs rejected',validation)
    def idempotency():
        bank=a.request('GET','/self/questions'); body={'version':bank['version'],'answers':[{'question_id':q['id'],'choice':'B'} for q in bank['questions']]}; key=secrets.token_hex(16)
        def submit(_):
            c=Client(BASE); c.restore(a.dump()); return c.request('POST','/self/assessments',body,key=key)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(submit,range(4)))
        assert len({r['id'] for r in results})==1
        changed=json.loads(json.dumps(body)); changed['answers'][0]['choice']='A'; a.request('POST','/self/assessments',changed,key=key,statuses=(409,))
    test('concurrent exact idempotency and body-conflict guard',idempotency)
    g=a.request('POST','/guesses',{'source_type':'self','answer_id':ar['answers'][0]['id']}); gp='/guesses/'+g['token']; reverse=None
    def guess():
        nonlocal reverse
        hidden(b.request('GET',gp)); hidden(outsider.request('GET',gp))
        a.request('POST',gp+'/answers',{'choice':'A'},statuses=(403,))
        b.request('POST',gp+'/reverse',{'choice':'B'},statuses=(403,409,422))
        r=b.request('POST',gp+'/answers',{'choice':'A'}); assert r['actual_choice']=='A' and r['correct']
        hidden(outsider.request('GET',gp))
        b.request('POST',gp+'/answers',{'choice':'B'},statuses=(409,))
        reverse=b.request('POST',gp+'/reverse',{'choice':'B'})
        outsider.request('GET','/guesses/'+reverse['token'],statuses=(404,403))
        outsider.request('POST','/guesses/'+reverse['token']+'/answers',{'choice':'B'},statuses=(404,403))
        hidden(a.request('GET','/guesses/'+reverse['token']))
        r=a.request('POST','/guesses/'+reverse['token']+'/answers',{'choice':'B'}); assert r['actual_choice']=='B'
        b.request('DELETE',gp,statuses=(404,403))
    test('Guess hides answer, locks attempts, binds reverse target',guess)
    def relationship_dedup():
        g2=a.request('POST','/guesses',{'source_type':'self','answer_id':ar['answers'][0]['id']}); r=b.request('POST','/guesses/'+g2['token']+'/answers',{'choice':'A'}); assert r['relationship']['total_count']==1

    test('same saved source does not inflate relationship count',relationship_dedup)
    def no_accuracy_rewrite():
        owner=new(); peer=new(); source=assess(owner)['answers'][0]['id']
        first=owner.request('POST','/guesses',{'source_type':'self','answer_id':source})
        wrong=peer.request('POST','/guesses/'+first['token']+'/answers',{'choice':'B'}); assert wrong['relationship']['correct_count']==0
        owner.request('DELETE','/guesses/'+first['token'],statuses=(204,))
        second=owner.request('POST','/guesses',{'source_type':'self','answer_id':source})
        again=peer.request('POST','/guesses/'+second['token']+'/answers',{'choice':'A'})
        assert again['relationship']['total_count']==1 and again['relationship']['correct_count']==0

    test('reissued source cannot rewrite first-guess accuracy',no_accuracy_rewrite)
    co=new(); cr=assess(co); cp=new(); cq=new(); cs=new(); ci=co.request('POST','/invites',{'self_assessment_id':cr['id']}); old=ci['token']; old_session=cp.request('POST','/invites/'+old+'/start',{'consent':True})
    def recreate():
        nonlocal ci
        co.request('DELETE','/invites/'+old,statuses=(204,))
        ci=co.request('POST','/invites',{'self_assessment_id':cr['id']}); t=ci['token']; assert t!=old
        s=cp.request('POST','/invites/'+t+'/start',{'consent':True})
        # The cohort must still hold 3 usable distinct variants after link recreation.
        ss=[s,cq.request('POST','/invites/'+t+'/start',{'consent':True}),cs.request('POST','/invites/'+t+'/start',{'consent':True})]
        assert len({tuple(q['id'] for q in s['questions']) for s in ss})==3
        for c,s in zip([cp,cq,cs],ss): c.request('POST','/invites/'+t+'/responses',{'session_id':s['session_id'],'answers':[{'question_id':q['id'],'choice':'A'} for q in s['questions']]})
        assert co.request('GET','/mirror')['completed_count']==3

    test('revoke/recreate does not strand cohort reservations',recreate)
    def delete_respondent():
        cp.request('DELETE','/me',{'confirmation':'DELETE'},statuses=(204,))
        m=co.request('GET','/mirror'); assert m['completed_count']==2 and m['state']=='partial'
        new_peer=new(); reply(new_peer,ci['token']); assert co.request('GET','/mirror')['completed_count']==3

    test('respondent deletion removes aggregate and frees a variant',delete_respondent)

    def frozen_mirror():
        with sqlite3.connect(DB) as db:
            rows=db.execute('SELECT session_id,questions_json FROM friend_assignments WHERE invite_token=?',(ci['token'],)).fetchall()
            for sid,raw in rows:
                qs=json.loads(raw)
                for q in qs:
                    if q['dimension']=='D1': q['direction_a']=-1
                db.execute('UPDATE friend_assignments SET questions_json=? WHERE session_id=?',(json.dumps(qs),sid))
        m=co.request('GET','/mirror'); d=next(c for c in m['comparisons'] if c['dimension']=='D1')
        assert d['a_count']==0 and d['b_count']==3 and d['relation']=='gap'
        with sqlite3.connect(DB) as db: db.execute('UPDATE assessments SET version=? WHERE id=?',('incompatible-old-bank',cr['id']))
        co.request('GET','/mirror',statuses=(409,))
        with sqlite3.connect(DB) as db: db.execute('UPDATE assessments SET version=? WHERE id=?',(cr['version'],cr['id']))

    test('mirror uses stored polarity and rejects mismatched versions',frozen_mirror)
    def frozen_pulse():
        c=new(); p=c.request('GET','/pulse/today'); r=c.request('POST','/pulse/'+p['id']+'/answers',{'choice':'A'}); aid=r['answer']['id']
        snapshot=dict(p['question']); snapshot['prompt']='Synthetic immutable old wording'
        with sqlite3.connect(DB) as db: db.execute('UPDATE pulse_answers SET question_json=? WHERE id=?',(json.dumps(snapshot),aid))
        assert c.request('GET','/journal')['entries'][0]['question']['prompt']==snapshot['prompt']
        g=c.request('POST','/guesses',{'source_type':'pulse','answer_id':aid}); assert c.request('GET','/guesses/'+g['token'])['question']['prompt']==snapshot['prompt']
        assert c.request('GET','/pulse/today')['question']['prompt']==snapshot['prompt'], 'Today reinterprets saved answer with current catalog wording'
        snapshot['version']='synthetic-archived-version'
        with sqlite3.connect(DB) as db: db.execute('UPDATE pulse_answers SET question_json=?,version=? WHERE id=?',(json.dumps(snapshot),snapshot['version'],aid))
        other=new(); current=other.request('GET','/pulse/today'); other.request('POST','/pulse/'+current['id']+'/answers',{'choice':'B'})
        old=c.request('GET','/pulse/today'); assert old['question']['version']==snapshot['version'] and old['crowd']['sample_size']==1, 'Versioned population cohort was mixed'
        other_user=other.request('GET','/session')['user']['id']
        with sqlite3.connect(DB) as db: db.execute('UPDATE pulse_answers SET version=?,region=? WHERE user_id=?',(snapshot['version'],'synthetic-other-region',other_user))
        assert c.request('GET','/pulse/today')['crowd']['sample_size']==1, 'Regional population cohort was mixed'
        with sqlite3.connect(DB) as db: db.execute('UPDATE pulse_answers SET region=? WHERE user_id=?',('CN',other_user))
        assert c.request('GET','/pulse/today')['crowd']['sample_size']==2, 'Expected matching cohort contribution missing'

    test('Pulse journal, Guess and Today preserve saved question wording',frozen_pulse)
    def solo_baseline():
        c=new(); result=assess(c); user=c.request('GET','/session')['user']['id']
        catalog=json.load(open(ROOT / 'backend/src/questions.json'))
        qs=[next(q for q in catalog if q['id']==qid) for qid in ['PULSE-08','PULSE-12','PULSE-25','PULSE-08','PULSE-12','PULSE-25','PULSE-08']]
        with sqlite3.connect(DB) as db:
            for day,q in zip(range(10,17),qs):
                date=f'2026-10-{day:02}'
                db.execute('INSERT INTO pulse_answers(id,user_id,day,question_id,question_json,version,region,choice,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(secrets.token_hex(16),user,date,q['id'],json.dumps(q),q['version'],'CN','A',date+'T12:00:00.000Z'))
            db.execute('UPDATE assessments SET created_at=? WHERE id=?',('2026-10-15T00:00:00.000Z',result['id']))
        s=c.request('GET','/solo'); assert s['eligible'] and s['self_comparison'] is None
        with sqlite3.connect(DB) as db: db.execute('UPDATE assessments SET created_at=? WHERE id=?',('2026-10-09T15:59:59.000Z',result['id']))
        s=c.request('GET','/solo'); assert s['self_comparison']['kind']=='echo'
        with sqlite3.connect(DB) as db: db.execute('UPDATE assessments SET created_at=? WHERE id=?',('2026-10-09T16:00:00.000Z',result['id']))
        assert c.request('GET','/solo')['self_comparison'] is None

    test('Solo excludes later Self and respects CN window boundary',solo_baseline)

    def auth_upgrade():
        nonlocal a
        original=a.request('GET','/session')['user']['id']; old=Client(BASE); old.restore(a.dump()); username='security_'+secrets.token_hex(5); password=secrets.token_urlsafe(24); a.password=password
        s=a.request('POST','/auth/register',{'username':username,'password':password,'display_name':'Synthetic security test'}); a.csrf=s['csrf_token']; assert s['user']['id']==original
        assert old.request('GET','/session')['user'] is None
        assert a.request('GET','/self/latest') is not None
        before=b.request('GET','/session')['user']['id']; b.request('POST','/auth/login',{'username':username,'password':password},statuses=(409,)); assert b.request('GET','/session')['user']['id']==before
        exported=a.request('GET','/me/export'); s=json.dumps(exported); assert 'password_hash' not in s and 'token_hash' not in s and 'csrf_token' not in s

    test('upgrade rotates session, preserves records, merge fails without loss, export excludes credentials',auth_upgrade)
    def expiry():
        x=a.request('POST','/guesses',{'source_type':'self','answer_id':ar['answers'][1]['id']})
        with sqlite3.connect(DB) as db: db.execute('UPDATE challenges SET expires_at=0 WHERE token=?',(x['token'],))
        hidden(outsider.request('GET','/guesses/'+x['token'],statuses=(404,410)))
        outsider.request('POST','/guesses/'+x['token']+'/answers',{'choice':'A'},statuses=(404,410))

    test('expired Guess cannot be read or answered',expiry)
    def deletion():
        a.request('DELETE','/me',{'confirmation':'wrong'},statuses=(400,422))
        a.request('DELETE','/me',{'confirmation':'DELETE','password':a.password},statuses=(204,))
        assert a.request('GET','/session')['user'] is None
        outsider.request('GET',gp,statuses=(404,410))
        assert b.request('GET','/self/latest')['id']==br['id']
        if reverse: b.request('GET','/guesses/'+reverse['token'],statuses=(404,410))
        with sqlite3.connect(DB) as db:
            cached=db.execute("SELECT count(*) FROM idempotency_keys i WHERE i.scope LIKE 'guesses.answer:%' AND NOT EXISTS(SELECT 1 FROM challenges c WHERE i.scope='guesses.answer:'||c.token)").fetchone()[0]
            assert cached==0, 'Deleted owner answer remains in peer idempotency cache'

    test('account deletion revokes owned/targeted links and preserves other own answers',deletion)

    def session_expiry():
        c=new(); user=c.request('GET','/session')['user']['id']
        cookie=next(cookie for cookie in c.jar if cookie.name=='nolya_session')
        assert len(cookie.value)==64 and len(bytes.fromhex(cookie.value))==32
        assert cookie.has_nonstandard_attr('HttpOnly') and cookie.get_nonstandard_attr('SameSite')=='Lax'
        with sqlite3.connect(DB) as db:
            stored=db.execute('SELECT token_hash FROM sessions WHERE user_id=?',(user,)).fetchone()[0]
            assert stored!=cookie.value and stored==hashlib.sha256(cookie.value.encode()).hexdigest()
            db.execute('UPDATE sessions SET expires_at=0 WHERE user_id=?',(user,))
        assert c.request('GET','/session')['user'] is None
        c.request('GET','/me/export',statuses=(401,))
        c.request('PATCH','/me',{'display_name':'expired session'},statuses=(401,403))

    test('session cookie properties, digested storage and expiry enforcement',session_expiry)
    def response_headers():
        c=new()
        with c.opener.open(c.base+'/session') as response:
            assert response.headers.get('Cache-Control')=='no-store'
            assert response.headers.get('X-Content-Type-Options')=='nosniff'
            assert response.headers.get('Referrer-Policy')=='no-referrer'
            assert response.headers.get('X-Frame-Options')=='DENY'
            assert "frame-ancestors 'none'" in response.headers.get('Content-Security-Policy','')

    test('private responses carry no-store and defensive browser headers',response_headers)

    print('SUMMARY:',len(failures),'failures',','.join(failures),flush=True)
    return bool(failures)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, default=ROOT / 'backend/target/debug/nolya-api')
    parser.add_argument('--port', type=int, default=0, help='Loopback port, default selects an unused ephemeral port')
    args = parser.parse_args()
    binary = args.binary.resolve()
    if not binary.is_file():
        parser.error('Backend binary is missing. Build backend/Cargo.toml first.')
    if not 0 <= args.port <= 65535:
        parser.error('Port must be between 0 and 65535.')
    # Refuse occupied ports before any HTTP request, preventing accidental use of
    # an already-running application with real user data.
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', args.port))
        port = probe.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    with tempfile.TemporaryDirectory(prefix='nolya-security-') as temp:
        db = str(Path(temp) / 'synthetic.sqlite')
        env = dict(os.environ, NOLYA_ENV='development', NOLYA_BIND=f'127.0.0.1:{port}', NOLYA_DB_PATH=db,
                   NOLYA_PUBLIC_ORIGIN=base, NOLYA_ALLOWED_ORIGINS=base,
                   NOLYA_COOKIE_SECURE='false', RUST_LOG='warn')
        with (Path(temp) / 'server.log').open('w+') as log:
            proc = subprocess.Popen([str(binary)], cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                ready = False
                for _ in range(100):
                    if proc.poll() is not None:
                        raise RuntimeError('Isolated backend exited before readiness; no tests executed.')
                    try:
                        with urllib.request.urlopen(base + '/api/v1/health', timeout=0.5) as response:
                            ready = response.status == 200
                    except (urllib.error.URLError, TimeoutError):
                        pass
                    if ready and Path(db).is_file():
                        break
                    time.sleep(0.05)
                if not ready or proc.poll() is not None or not Path(db).is_file():
                    raise RuntimeError('Isolated backend did not become ready; no tests executed.')
                return int(run_suite(base, db))
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError) as exc:
        print('BLOCKED:', str(exc), file=sys.stderr)
        sys.exit(2)
