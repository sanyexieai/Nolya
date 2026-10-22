#!/usr/bin/env python3
"""Real HTTP acceptance suite. Run against an isolated local Nolya database.

python3 tests/e2e_api.py --base http://127.0.0.1:3000 --state /tmp/nolya-e2e.json
Restart the same backend/database, then run with --resume and the same state file.
The state file contains test session credentials: mode 0600, never commit it.
"""
import argparse
import concurrent.futures
import http.cookiejar
import json
import os
import secrets
import sys
import urllib.error
import urllib.request
import urllib.parse
from pathlib import Path


class Client:
    def __init__(self, base):
        self.base = base.rstrip('/') + '/api/v1'
        parsed = urllib.parse.urlsplit(base)
        self.origin = parsed.scheme + '://' + parsed.netloc
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None

    def request(self, method, path, body=None, statuses=(200, 201), key=None, csrf=True, origin=None):
        headers = {'Accept': 'application/json'}
        headers['Origin'] = origin if origin is not None else self.origin
        data = None
        if method != 'GET':
            headers['Content-Type'] = 'application/json'
            headers['Idempotency-Key'] = key or secrets.token_hex(16)
            if csrf and self.csrf:
                headers['X-CSRF-Token'] = self.csrf
            if body is not None:
                data = json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            r = self.opener.open(req, timeout=20)
        except urllib.error.HTTPError as e:
            r = e
        raw = r.read()
        obj = json.loads(raw) if raw else None
        if r.status not in statuses:
            code = obj.get('error', {}).get('code') if isinstance(obj, dict) else None
            # Avoid logging invitation URLs, response bodies, cookies or passwords.
            raise AssertionError(f'{method} endpoint returned {r.status}, expected {statuses}; error={code}')
        return obj

    def guest(self):
        s = self.request('POST', '/session/guest', {'locale': 'zh-CN'})
        assert s['user']['kind'] == 'guest' and s['csrf_token']
        self.csrf = s['csrf_token']
        return s

    def dump(self):
        return {'csrf': self.csrf, 'cookies': [dict(vars(c)) for c in self.jar]}

    def restore(self, data):
        self.csrf = data['csrf']
        for d in data['cookies']:
            # Cookie constructor uses rest instead of its private storage field.
            d = dict(d)
            d['rest'] = d.pop('_rest', {})
            self.jar.set_cookie(http.cookiejar.Cookie(**d))


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def hidden(value):
    forbidden = {'actual_choice', 'owner_choice', 'is_correct', 'correct'}
    if isinstance(value, dict):
        check(not (set(value) & forbidden), 'Unsubmitted public context leaked answer/result key')
        for v in value.values():
            hidden(v)
    elif isinstance(value, list):
        for v in value:
            hidden(v)


def passed(name):
    print('PASS:', name, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:3000')
    parser.add_argument('--state', default='/tmp/nolya-e2e-state.json')
    parser.add_argument('--resume', action='store_true')
    args = parser.parse_args()
    owner = Client(args.base)
    if args.resume:
        state = json.loads(Path(args.state).read_text())
        owner.restore(state['owner'])
        check(owner.request('GET', '/session')['user']['kind'] == 'registered', 'Account not persistent')
        check(owner.request('GET', '/self/latest')['id'] == state['latest_id'], 'Self not persistent')
        mirror = owner.request('GET', '/mirror?self_assessment_id=' + state['assessment_id'])
        check(mirror['completed_count'] == 3 and mirror['state'] == 'full', 'Mirror not persistent')
        check(owner.request('GET', '/journal')['total'] >= 1, 'Pulse history not persistent')
        peer = Client(args.base)
        peer.restore(state['peer'])
        reveal = peer.request('GET', '/guesses/' + state['guess_token'])['reveal']
        check(reveal and reveal['actual_choice'] == 'A' and reveal['correct'], 'Reveal not persistent')
        passed('post-restart persisted account, Self, mirror, journal and reveal')
        print('NOTE: restart is performed by the operator; this command does not restart the service.')
        return

    owner.request('GET', '/health')
    check(owner.request('GET', '/session')['user'] is None, 'GET session created identity')
    initial = owner.guest()
    peers = [Client(args.base) for _ in range(4)]
    ids = [initial['user']['id']] + [c.guest()['user']['id'] for c in peers]
    check(len(set(ids)) == 5, 'Independent cookie jars share identity')
    passed('five independent identities')
    bank = owner.request('GET', '/self/questions')
    qs = bank['questions']
    check(len(qs) == 8 and len({q['id'] for q in qs}) == 8, 'Expected eight distinct questions')
    for dim in ['D1', 'D2', 'D3', 'D4']:
        check(sum(q['dimension'] == dim for q in qs) == 2, 'Expected two questions per dimension')
    body = {'version': bank['version'], 'answers': [{'question_id': q['id'], 'choice': 'A'} for q in qs]}
    owner.request('POST', '/self/assessments', {**body, 'answers': body['answers'][:-1]}, statuses=(400, 422))
    key = secrets.token_hex(16)
    owner.request('POST', '/self/assessments', body, csrf=False, statuses=(403,))
    owner.request('POST', '/self/assessments', body, origin='https://untrusted.invalid', statuses=(403,))
    result = owner.request('POST', '/self/assessments', body, key=key)
    changed = {'version': body['version'], 'answers': [dict(a) for a in body['answers']]}
    changed['answers'][0]['choice'] = 'B'
    owner.request('POST', '/self/assessments', changed, key=key, statuses=(409,))
    check(owner.request('POST', '/self/assessments', body, key=key)['id'] == result['id'], 'Self replay duplicated')
    check(all(d['score'] == 1 for d in result['dimensions']), 'All-A Self scoring incorrect')
    check(result['target_dimensions'] == ['D1', 'D2', 'D4'], 'Stable target order differs')
    aid = result['id']
    passed('eight-question validation, immutable Self and idempotency')

    inv = owner.request('POST', '/invites', {'self_assessment_id': aid})
    token = inv['token']
    route = '/invites/' + token
    owner.request('POST', route + '/start', {'consent': True}, statuses=(403,))
    sessions = []
    for peer in peers[:3]:
        context = peer.request('GET', route)
        hidden(context)
        s = peer.request('POST', route + '/start', {'consent': True})
        check(len(s['questions']) == 3, 'Friend question count')
        check(all(q['id'] != 'FRIEND-D1-A' for q in s['questions']), 'Ambiguous friend question active')
        check(peer.request('POST', route + '/start', {'consent': True})['session_id'] == s['session_id'], 'Repeated start consumed another slot')
        sessions.append(s)
    stolen_payload = {'session_id': sessions[0]['session_id'], 'answers': [{'question_id': q['id'], 'choice': 'A'} for q in sessions[0]['questions']]}
    peers[3].request('POST', route + '/responses', stolen_payload, statuses=(403, 404))
    for i, (peer, s) in enumerate(zip(peers[:3], sessions)):
        answers = [{'question_id': q['id'], 'choice': 'B' if q['dimension'] == 'D2' and i < 2 else 'A'} for q in s['questions']]
        payload = {'session_id': s['session_id'], 'answers': answers}
        peer.request('POST', route + '/responses', payload)
        peer.request('POST', route + '/responses', payload, statuses=(200, 201, 409))
        mirror = owner.request('GET', '/mirror')
        check(mirror['completed_count'] == i + 1, 'Duplicate response changed count')
        check(mirror['state'] == ['first', 'partial', 'full'][i], 'Mirror threshold incorrect')
        if i < 2:
            check(all(c['consensus'] == 'insufficient' and c['relation'] == 'insufficient' for c in mirror['comparisons']), 'Premature consensus')
    check(mirror['respondent_basis'] == 'distinct_sessions' and mirror['identity_notice'], 'Missing honest identity limitation')
    by_dim = {d['dimension']: d for d in mirror['comparisons']}
    check(by_dim['D1']['relation'] == 'aligned' and by_dim['D1']['a_count'] == 3, 'Expected unanimous D1 alignment')
    check(by_dim['D2']['relation'] == 'gap' and by_dim['D2']['b_count'] == 2, 'Expected D2 gap 2/3')
    peers[3].request('POST', route + '/start', {'consent': True}, statuses=(409,))
    peers[3].request('GET', '/mirror?self_assessment_id=' + aid, statuses=(403, 404))
    passed('three real respondents, threshold states, deduplication, fourth blocked and owner isolation')

    pulse = owner.request('GET', '/pulse/today')
    check(pulse['crowd'] is None and pulse['answer'] is None, 'Pulse leaked before answer')
    ppath = '/pulse/' + pulse['id'] + '/answers'
    saved = owner.request('POST', ppath, {'choice': 'A'})
    crowd = saved['crowd']
    check(crowd['sample_size'] >= 1, 'No real vote counted')
    if crowd['sample_size'] < 50:
        check(crowd['a_percent'] is None and crowd['b_percent'] is None and crowd['mode'] != 'percentage', 'Small-sample false percentage')
    else:
        raise AssertionError('Suite requires isolated database for N<50 scenario')
    check(owner.request('POST', ppath, {'choice': 'A'})['crowd']['sample_size'] == crowd['sample_size'], 'Pulse duplicate counted')
    owner.request('POST', ppath, {'choice': 'B'}, statuses=(409,))
    check(peers[3].request('GET', '/pulse/today')['crowd'] is None, 'Other guest sees distribution before answer')
    passed('Pulse gated statistics, honest small samples and immutable vote')
    check(crowd['sample_size'] == 1, '49/50 boundary test needs isolated DB with first vote only')
    # These are real HTTP votes by distinct server-issued browser identities.
    # They are test fixtures, never claimed to represent 50 real human users.
    for index in range(2, 51):
        voter = Client(args.base)
        voter.guest()
        outcome = voter.request('POST', ppath, {'choice': 'B'})
        check(outcome['crowd']['sample_size'] == index, 'Vote count boundary incorrect')
        if index < 50:
            check(outcome['crowd']['a_percent'] is None and outcome['crowd']['b_percent'] is None, 'Percentage exposed below 50')
        else:
            check(outcome['crowd']['mode'] == 'percentage' and outcome['crowd']['a_percent'] == 2 and outcome['crowd']['b_percent'] == 98, '50-vote percentage not derived from 1A/49B')
    passed('49/50 sample boundary using 50 actual isolated test-identity votes')

    owner.request('POST', '/guesses', {'source_type': 'self', 'answer_id': 'nonexistent-answer'}, statuses=(404, 422))
    g = owner.request('POST', '/guesses', {'source_type': 'self', 'answer_id': result['answers'][0]['id']})
    gr = '/guesses/' + g['token']
    hidden(peers[0].request('GET', gr))
    owner.request('POST', gr + '/answers', {'choice': 'A'}, statuses=(403,))
    reveal = peers[0].request('POST', gr + '/answers', {'choice': 'A'})
    check(reveal['actual_choice'] == 'A' and reveal['correct'] is True, 'Reveal correctness')
    again = peers[0].request('POST', gr + '/answers', {'choice': 'A'})
    check(again['relationship']['total_count'] == reveal['relationship']['total_count'], 'Guess replay inflated score')
    peers[0].request('POST', gr + '/answers', {'choice': 'B'}, statuses=(409,))
    hidden(peers[3].request('GET', gr))
    peers[3].request('POST', gr + '/answers', {'choice': 'INVALID'}, statuses=(400, 422))
    g2 = owner.request('POST', '/guesses', {'source_type': 'self', 'answer_id': result['answers'][1]['id']})
    owner.request('DELETE', '/guesses/' + g2['id'], statuses=(204,))
    hidden(peers[3].request('GET', '/guesses/' + g2['token'], statuses=(404, 410)))
    peers[3].request('POST', '/guesses/' + g2['token'] + '/answers', {'choice': 'A'}, statuses=(404, 410))
    passed('Guess hidden answer, atomic reveal, self-guess denial, replay and revocation')

    newbody = {'version': bank['version'], 'answers': [{'question_id': q['id'], 'choice': 'B'} for q in qs]}
    newresult = owner.request('POST', '/self/assessments', newbody)
    old = owner.request('GET', '/mirror?self_assessment_id=' + aid)
    check(old['completed_count'] == 3 and all(c['self_score'] == 1 for c in old['comparisons']), 'Old cohort rebound to new Self')
    check(owner.request('GET', '/mirror')['completed_count'] == 0, 'New Self inherited old judgments')
    passed('Self reassessment preserves frozen cohort')
    concurrent_inv = owner.request('POST', '/invites', {'self_assessment_id': newresult['id']})
    cr = '/invites/' + concurrent_inv['token']
    def start_concurrent(peer):
        return peer, peer.request('POST', cr + '/start', {'consent': True}, statuses=(200, 201, 409))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        starts = list(pool.map(start_concurrent, peers))
    accepted = [(p, r) for p, r in starts if 'session_id' in r]
    check(len(accepted) == 3, 'Concurrent four respondents did not allocate exactly three slots')
    check(len({r['session_id'] for _, r in accepted}) == 3, 'Concurrent slots duplicated')
    jobs = []
    for peer, session in accepted:
        payload = {'session_id': session['session_id'], 'answers': [{'question_id': q['id'], 'choice': 'A'} for q in session['questions']]}
        for _ in range(2):
            clone = Client(args.base)
            clone.restore(peer.dump())
            jobs.append((clone, payload))
    def submit_concurrent(job):
        peer, payload = job
        return peer.request('POST', cr + '/responses', payload, statuses=(200, 201, 409))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(submit_concurrent, jobs))
    check(owner.request('GET', '/mirror')['completed_count'] == 3, 'Concurrent duplicate submissions inflated mirror')
    passed('four-way slot race and six duplicate submissions preserve three-person cohort')
    username = 'e2e_' + secrets.token_hex(6)
    upgraded = owner.request('POST', '/auth/register', {'username': username, 'password': secrets.token_urlsafe(24), 'display_name': '验收用户'})
    owner.csrf = upgraded['csrf_token']
    check(upgraded['user']['id'] == initial['user']['id'] and upgraded['user']['kind'] == 'registered', 'Upgrade lost identity')
    check(owner.request('GET', '/self/latest')['id'] == newresult['id'], 'Upgrade lost Self')
    check(owner.request('GET', '/mirror?self_assessment_id=' + aid)['completed_count'] == 3, 'Upgrade lost mirror')
    check(owner.request('GET', '/journal')['total'] >= 1, 'Upgrade lost Pulse')
    state = {'owner': owner.dump(), 'peer': peers[0].dump(), 'assessment_id': aid, 'latest_id': newresult['id'], 'guess_token': g['token']}
    fd = os.open(args.state, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(state, f)
    passed('guest upgrade retains identity and records; restart checkpoint saved')
    print('REMAINING: actual restart + --resume; clock-controlled expiry; existing-account merge; production anti-abuse.')


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, OSError, ValueError, KeyError, TypeError) as exc:
        print('FAIL:', type(exc).__name__, str(exc), file=sys.stderr)
        sys.exit(1)
