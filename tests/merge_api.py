#!/usr/bin/env python3
"""Adversarial guest-to-existing-account merge HTTP regressions.

Build first: cargo build --manifest-path backend/Cargo.toml
Run: python3 tests/merge_api.py [--binary PATH] [--port 3012]

Every case owns a fresh loopback server and disposable SQLite database containing
ONLY synthetic identities. No external URL or existing database is accepted.
Synthetic credentials, cookies, logs and databases are never printed or retained.
The client and server run in the same invocation/process namespace. Fresh servers
also keep cases independent of production authentication rate-limit counters.
"""
import argparse
import concurrent.futures
from contextlib import contextmanager
import copy
from datetime import datetime
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
DOMAIN_TABLES = (
    'users', 'sessions', 'assessments', 'self_feedback', 'friend_invites',
    'friend_assignments', 'friend_responses', 'pulse_answers', 'challenges',
    'guesses', 'journal_notes', 'idempotency_keys', 'analytics_events',
)
OWNERSHIP_COLUMNS = {
    'assessments': ('user_id',), 'self_feedback': ('user_id',),
    'friend_invites': ('user_id',), 'friend_assignments': ('respondent_id',),
    'friend_responses': ('respondent_id',), 'pulse_answers': ('user_id',),
    'challenges': ('owner_id', 'target_user_id'), 'guesses': ('guesser_id',),
    'journal_notes': ('user_id',),
}


def check(value, message):
    if not value:
        raise AssertionError(message)


class MergeTests:
    def __init__(self, base, db):
        self.base, self.db = base, db

    def query(self, sql, values=()):
        with sqlite3.connect(self.db) as db:
            return db.execute(sql, values).fetchall()

    def scalar(self, sql, values=()):
        return self.query(sql, values)[0][0]

    def execute(self, sql, values=()):
        with sqlite3.connect(self.db) as db:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute(sql, values)

    def rows(self, table):
        with sqlite3.connect(self.db) as db:
            db.row_factory = sqlite3.Row
            return sorted((dict(r) for r in db.execute('SELECT * FROM ' + table)),
                          key=lambda r: json.dumps(r, sort_keys=True))

    def snapshot(self, tables=DOMAIN_TABLES):
        return {table: self.rows(table) for table in tables}

    def new(self):
        c = Client(self.base)
        c.uid = c.guest()['user']['id']
        return c

    def registered(self):
        c = self.new()
        c.username = 'merge_' + secrets.token_hex(6)
        c.password = secrets.token_urlsafe(24)
        s = c.request('POST', '/auth/register', {
            'username': c.username, 'password': c.password,
            'display_name': 'Synthetic destination',
        })
        c.csrf = s['csrf_token']
        return c

    def pair(self):
        return self.new(), self.registered()

    def clone(self, c):
        other = Client(self.base)
        other.restore(copy.deepcopy(c.dump()))
        other.uid = c.uid
        return other

    def extra_session(self, c):
        # This fixture is necessary because guest creation intentionally reuses
        # the current session rather than issuing another session for that guest.
        other = self.clone(c)
        token, csrf = secrets.token_hex(32), secrets.token_hex(32)
        for cookie in other.jar:
            if cookie.name == 'nolya_session':
                cookie.value = token
        other.csrf = csrf
        self.execute('INSERT INTO sessions VALUES(?,?,?,?,?)', (
            hashlib.sha256(token.encode()).hexdigest(), c.uid, csrf,
            int(time.time()) + 3600, '2026-01-01T00:00:00.000Z',
        ))
        check(other.request('GET', '/session')['user']['id'] == c.uid,
              'Synthetic extra session was not established')
        return other

    def assess(self, c, choice='A', key=None):
        bank = c.request('GET', '/self/questions')
        body = {
            'version': bank['version'],
            'answers': [{'question_id': q['id'], 'choice': choice} for q in bank['questions']],
        }
        key = key or secrets.token_hex(16)
        c.last_assessment_request = (body, key)
        return c.request('POST', '/self/assessments', body, key=key)

    def pulse(self, c, choice='A'):
        p = c.request('GET', '/pulse/today')
        return c.request('POST', '/pulse/' + p['id'] + '/answers', {'choice': choice})['answer']

    def invite(self, c, assessment=None):
        assessment = assessment or self.assess(c)
        return c.request('POST', '/invites', {'self_assessment_id': assessment['id']})

    def start(self, c, invite):
        return c.request('POST', '/invites/' + invite['token'] + '/start', {'consent': True})

    def respond(self, c, invite, started=None):
        started = started or self.start(c, invite)
        c.request('POST', '/invites/' + invite['token'] + '/responses', {
            'session_id': started['session_id'],
            'answers': [{'question_id': q['id'], 'choice': 'A'} for q in started['questions']],
        })
        return started

    def challenge(self, c, assessment=None, index=0):
        assessment = assessment or self.assess(c)
        return c.request('POST', '/guesses', {
            'source_type': 'self', 'answer_id': assessment['answers'][index]['id'],
        })

    def answer(self, c, challenge, choice='A', **kwargs):
        return c.request('POST', '/guesses/' + challenge['token'] + '/answers',
                         {'choice': choice}, **kwargs)

    def preview(self, source, target, **kwargs):
        return source.request('POST', '/auth/merge/preview', {
            'username': target.username, 'password': target.password,
        }, **kwargs)

    def confirm(self, source, token, **kwargs):
        result = source.request('POST', '/auth/merge/confirm', {
            'merge_token': token, 'confirmation': 'MERGE',
        }, **kwargs)
        if result and result.get('user'):
            source.csrf = result['csrf_token']
        return result

    def valid_preview(self, source, target):
        before = self.snapshot()
        cookie = copy.deepcopy(source.dump())
        result = self.preview(source, target)
        check(result['can_merge'] is True and result['merge_token'], 'Expected a mergeable preview')
        check(result['conflicts'] == [], 'Mergeable preview reported conflicts')
        check(result['target'] == {'username': target.username, 'display_name': 'Synthetic destination'},
              'Preview target identity is not minimal and explicit')
        check(set(result['summary']) == {'self_assessments', 'pulse_answers', 'friend_responses',
              'friend_reservations', 'friend_invites', 'guesses', 'guess_links'}, 'Summary fields differ')
        check(all(type(n) is int and n >= 0 for n in result['summary'].values()), 'Invalid summary counts')
        check(result.get('notice'), 'Preview is missing a merge notice')
        hidden(result)
        check(self.snapshot() == before, 'Preview changed identity, ownership, session, or domain data')
        check(source.dump() == cookie, 'Preview rotated or replaced the source session')
        check(source.request('GET', '/session')['user']['id'] == source.uid, 'Preview switched identities')
        check(target.request('GET', '/session')['user']['id'] == target.uid, 'Preview changed target session')
        return result

    def blocked_preview(self, source, target, expected_code=None):
        before = self.snapshot()
        result = self.preview(source, target)
        check(result['can_merge'] is False and result['merge_token'] is None,
              'Conflicting data received a merge approval token')
        check(result['expires_at'] is None, 'Blocked preview has an approval expiry')
        check(result['conflicts'], 'Blocked preview did not explain conflicts')
        if expected_code:
            check(any(c['code'] == expected_code for c in result['conflicts']),
                  'Blocked preview did not identify ' + expected_code)
        for conflict in result['conflicts']:
            check(isinstance(conflict['code'], str) and conflict['code'], 'Conflict code missing')
            check(type(conflict['count']) is int and conflict['count'] > 0, 'Conflict count invalid')
            check(isinstance(conflict['message'], str) and conflict['message'], 'Conflict message missing')
        hidden(result)
        check(self.snapshot() == before, 'Blocked preview partially changed data or identities')
        check(self.scalar('SELECT count(*) FROM merge_previews WHERE source_user_id=?', (source.uid,)) == 0,
              'Blocked preview left a usable approval')
        return result

    def assert_error(self, result, code):
        check(result.get('error', {}).get('code') == code, 'Expected error code ' + code)

    def test_preview_cancel_is_read_only_and_token_is_hashed(self):
        source, target = self.pair()
        self.assess(source)
        result = self.valid_preview(source, target)
        raw = result['merge_token']
        check(len(raw) >= 32, 'Merge approval token is too short')
        approval = self.rows('merge_previews')
        check(len(approval) == 1, 'Preview did not store one approval')
        check(approval[0]['token_hash'] == hashlib.sha256(raw.encode()).hexdigest(),
              'Approval token is not stored as a SHA-256 digest')
        check(approval[0]['token_hash'] != raw, 'Plain merge token persisted')
        check(approval[0]['source_user_id'] == source.uid and approval[0]['target_user_id'] == target.uid,
              'Approval is not bound to both identities')
        check(approval[0]['session_hash'] == self.scalar(
            'SELECT token_hash FROM sessions WHERE user_id=?', (source.uid,)), 'Approval is not session bound')
        remaining = approval[0]['expires_at'] - int(time.time())
        check(0 < remaining <= 300, 'Approval lifetime exceeds five minutes')
        when = datetime.fromisoformat(result['expires_at'].replace('Z', '+00:00'))
        check(abs(when.timestamp() - approval[0]['expires_at']) < 1, 'Advertised token expiry differs')
        # Cancelling means leaving the approval unused. No confirmation endpoint
        # is called and neither account nor its existing data may change.
        check(source.request('GET', '/me/export')['user']['kind'] == 'guest', 'Unused preview merged source')

    def test_wrong_credentials_and_input_validation_never_mutate(self):
        source, target = self.pair()
        self.assess(source)
        before = self.snapshot()
        result = source.request('POST', '/auth/merge/preview', {
            'username': target.username, 'password': 'synthetic-wrong-password',
        }, statuses=(401,))
        self.assert_error(result, 'invalid_credentials')
        result = source.request('POST', '/auth/merge/preview', {
            'username': 'no_such_' + secrets.token_hex(5), 'password': target.password,
        }, statuses=(401,))
        self.assert_error(result, 'invalid_credentials')
        source.request('POST', '/auth/merge/preview', {
            'username': target.username, 'password': target.password, 'target_user_id': source.uid,
        }, statuses=(400, 422))
        source.request('POST', '/auth/merge/confirm', {
            'merge_token': secrets.token_hex(32), 'confirmation': 'MERGE', 'target_user_id': target.uid,
        }, statuses=(400, 422))
        check(self.snapshot() == before, 'Rejected credentials/input changed account data')
        check(not self.rows('merge_previews'), 'Rejected credentials created an approval')

    def test_session_csrf_origin_and_registered_source_guards(self):
        source, target = self.pair()
        anonymous = Client(self.base)
        anonymous.request('POST', '/auth/merge/preview', {
            'username': target.username, 'password': target.password,
        }, statuses=(401,))
        anonymous.request('POST', '/auth/merge/confirm', {
            'merge_token': secrets.token_hex(32), 'confirmation': 'MERGE',
        }, statuses=(401,))
        for kwargs in ({'csrf': False}, {'origin': 'https://untrusted.invalid'}):
            self.preview(source, target, statuses=(403,), **kwargs)
        p = self.valid_preview(source, target)
        before = self.snapshot()
        for kwargs in ({'csrf': False}, {'origin': 'https://untrusted.invalid'}):
            self.confirm(source, p['merge_token'], statuses=(403,), **kwargs)
        self.preview(target, target, statuses=(403, 409))
        self.confirm(target, p['merge_token'], statuses=(403, 409))
        check(self.snapshot() == before, 'Security rejection mutated merge participants')
        check(self.confirm(source, p['merge_token'])['user']['id'] == target.uid,
              'Security rejection consumed otherwise valid approval')

    def test_confirmation_text_expiry_and_new_preview_invalidate_old_token(self):
        source, target = self.pair()
        first = self.valid_preview(source, target)
        before = self.snapshot()
        source.request('POST', '/auth/merge/confirm', {
            'merge_token': first['merge_token'], 'confirmation': 'merge',
        }, statuses=(422,))
        check(self.snapshot() == before, 'Incorrect confirmation text mutated data')
        second = self.valid_preview(source, target)
        check(second['merge_token'] != first['merge_token'], 'Preview reused approval token')
        self.assert_error(self.confirm(source, first['merge_token'], statuses=(409,)), 'merge_preview_expired')
        self.execute('UPDATE merge_previews SET expires_at=0 WHERE source_user_id=?', (source.uid,))
        self.assert_error(self.confirm(source, second['merge_token'], statuses=(409,)), 'merge_preview_expired')
        self.assert_error(self.confirm(source, secrets.token_hex(32), statuses=(409,)), 'merge_preview_expired')
        check(self.snapshot() == before, 'Expired or unknown token changed data')

    def test_approval_is_bound_to_source_session_and_target(self):
        source, target = self.pair()
        other_session = self.extra_session(source)
        outsider = self.new()
        p = self.valid_preview(source, target)
        before = self.snapshot()
        self.assert_error(self.confirm(other_session, p['merge_token'], statuses=(409,)), 'merge_preview_expired')
        self.assert_error(self.confirm(outsider, p['merge_token'], statuses=(409,)), 'merge_preview_expired')
        check(self.snapshot() == before, 'Stolen approval changed ownership or sessions')
        merged = self.confirm(source, p['merge_token'])
        check(merged['user']['id'] == target.uid, 'Approval switched to a different destination')
        check(other_session.request('GET', '/session')['user'] is None, 'Other source session survived merge')

    def test_logout_cancels_approval_without_merging_or_changing_target(self):
        source, target = self.pair()
        self.assess(source)
        old_cookie = self.clone(source)
        p = self.valid_preview(source, target)
        before = self.snapshot([table for table in DOMAIN_TABLES if table != 'sessions'])
        source.request('POST', '/auth/logout', statuses=(204,))
        check(self.scalar('SELECT count(*) FROM merge_previews') == 0, 'Logout retained session-bound approval')
        self.confirm(old_cookie, p['merge_token'], statuses=(401, 403))
        check(self.snapshot([table for table in DOMAIN_TABLES if table != 'sessions']) == before,
              'Logout or cancelled approval changed identity or domain data')
        check(target.request('GET', '/session')['user']['id'] == target.uid, 'Logout affected destination session')

    def test_success_consumes_approvals_from_all_source_sessions(self):
        source, target = self.pair()
        second = self.extra_session(source)
        first_preview = self.valid_preview(source, target)
        second_preview = self.valid_preview(second, target)
        check(self.scalar('SELECT count(*) FROM merge_previews') == 2, 'Independent source sessions lack independent approvals')
        check(self.confirm(source, first_preview['merge_token'])['user']['id'] == target.uid, 'First approval could not merge')
        check(self.scalar('SELECT count(*) FROM merge_previews') == 0, 'Merge left another source session approval behind')
        self.confirm(second, second_preview['merge_token'], statuses=(401, 403, 409))
        check(second.request('GET', '/session')['user'] is None, 'Other source session survives approval consumption')

    def test_deleted_destination_cannot_be_replaced_under_old_approval(self):
        source, target = self.pair()
        self.assess(source)
        p = self.valid_preview(source, target)
        target.request('DELETE', '/me', {'confirmation': 'DELETE', 'password': target.password}, statuses=(204,))
        replacement = self.new()
        result = replacement.request('POST', '/auth/register', {
            'username': target.username, 'password': target.password,
            'display_name': 'Synthetic replacement',
        })
        replacement.csrf = result['csrf_token']
        before = self.snapshot()
        self.assert_error(self.confirm(source, p['merge_token'], statuses=(409,)), 'merge_preview_expired')
        check(self.snapshot() == before, 'Old approval merged into a replacement username identity')
        check(source.request('GET', '/session')['user']['id'] == source.uid, 'Deleted target consumed source identity')

    def test_full_graph_transfer_preserves_snapshots_links_sessions_export_and_deletion(self):
        source, target = self.pair()
        old_source = self.clone(source)
        second_source = self.extra_session(source)
        target_session = self.clone(target)
        peer, reservation_peer, third_owner, unrelated = [self.new() for _ in range(4)]
        sa, ta = self.assess(source), self.assess(target, 'B')
        source_assessment_request = copy.deepcopy(source.last_assessment_request)
        target_assessment_request = copy.deepcopy(target.last_assessment_request)
        source.request('POST', '/self/assessments/' + sa['id'] + '/feedback', {'rating': 'very_like'})
        source.request('PATCH', '/me', {'display_name': 'Synthetic guest', 'locale': 'en'})
        sp, tp = self.pulse(source), self.pulse(target, 'B')
        self.execute('UPDATE pulse_answers SET day=? WHERE id=?', ('2000-01-01', tp['id']))
        saved = json.loads(self.scalar('SELECT question_json FROM pulse_answers WHERE id=?', (sp['id'],)))
        saved['prompt'] = 'Synthetic immutable archived wording'
        self.execute('UPDATE pulse_answers SET question_json=? WHERE id=?', (json.dumps(saved), sp['id']))
        self.execute('INSERT INTO journal_notes VALUES(?,?,?,?)',
                     (source.uid, sp['id'], 'Synthetic retained note', '2000-01-02T00:00:00.000Z'))
        owned_invite = self.invite(source, sa)
        self.respond(peer, owned_invite)
        self.start(reservation_peer, owned_invite)
        received_invite = self.invite(third_owner)
        self.respond(source, received_invite)
        pending_invite = self.invite(third_owner)
        pending_session = self.start(source, pending_invite)
        owned_round = self.challenge(source, sa)
        peer_answer_key = secrets.token_hex(16)
        self.answer(peer, owned_round, key=peer_answer_key)
        incoming_reverse = peer.request('POST', '/guesses/' + owned_round['token'] + '/reverse', {'choice': 'B'})
        received_round = self.challenge(third_owner)
        self.answer(source, received_round)
        owned_reverse = source.request('POST', '/guesses/' + received_round['token'] + '/reverse', {'choice': 'B'})
        revoked_round = self.challenge(source, sa, 1)
        source.request('DELETE', '/guesses/' + revoked_round['token'], statuses=(204,))
        expired_round = self.challenge(source, sa, 2)
        self.execute('UPDATE challenges SET expires_at=0 WHERE token=?', (expired_round['token'],))
        revoked_invite = self.invite(source)
        source.request('DELETE', '/invites/' + revoked_invite['token'], statuses=(204,))
        unrelated_assessment = self.assess(unrelated)
        unrelated_cache = self.query('SELECT * FROM idempotency_keys WHERE user_id=?', (unrelated.uid,))
        old_target_profile = self.query('SELECT * FROM users WHERE id=?', (target.uid,))
        domain_before = self.snapshot(OWNERSHIP_COLUMNS)
        p = self.valid_preview(source, target)
        expected_counts = {
            'self_assessments': self.scalar('SELECT count(*) FROM assessments WHERE user_id=?', (source.uid,)),
            'pulse_answers': 1, 'friend_responses': 1, 'friend_reservations': 1,
            'friend_invites': 2, 'guesses': 1, 'guess_links': 4,
        }
        check(p['summary'] == expected_counts, 'Preview counts do not describe source data accurately')
        result = self.confirm(source, p['merge_token'])
        check(result['user']['id'] == target.uid and result['user']['kind'] == 'registered',
              'Successful merge did not return destination session')
        check(result['csrf_token'] != old_source.csrf, 'Merge reused source CSRF token')
        check(self.query('SELECT * FROM users WHERE id=?', (target.uid,)) == old_target_profile,
              'Merge overwrote destination profile, credentials, or creation time')
        check(self.scalar('SELECT count(*) FROM users WHERE id=?', (source.uid,)) == 0, 'Source identity survived')
        check(self.scalar('SELECT count(*) FROM sessions WHERE user_id=?', (source.uid,)) == 0, 'Source sessions survived')
        check(old_source.request('GET', '/session')['user'] is None, 'Source cookie still authenticates')
        check(second_source.request('GET', '/session')['user'] is None, 'Secondary source cookie still authenticates')
        check(target_session.request('GET', '/session')['user']['id'] == target.uid, 'Existing target session invalidated')
        old_source.request('GET', '/me/export', statuses=(401,))
        for table, columns in OWNERSHIP_COLUMNS.items():
            expected = copy.deepcopy(domain_before[table])
            for row in expected:
                for column in columns:
                    if row[column] == source.uid:
                        row[column] = target.uid
            expected.sort(key=lambda r: json.dumps(r, sort_keys=True))
            check(self.rows(table) == expected, 'Transfer changed IDs, snapshots, timestamps, or links in ' + table)
        check(not self.query('PRAGMA foreign_key_check'), 'Merge left broken foreign keys')
        check(self.query('SELECT * FROM idempotency_keys WHERE user_id=?', (unrelated.uid,)) == unrelated_cache,
              'Merge deleted unrelated cache entries')
        check(self.scalar('SELECT count(*) FROM idempotency_keys WHERE user_id=?', (source.uid,)) == 0,
              'Merge retained source-owned replay guards')
        check(self.scalar(
            "SELECT count(*) FROM idempotency_keys WHERE user_id=? AND scope<>'self.create' "
            "AND (invalidated<>1 OR response_json<>'null')", (target.uid,)) == 0,
              'Merge retained stale participant response bodies')
        check(self.query('SELECT invalidated,response_json FROM idempotency_keys WHERE user_id=? AND scope=?',
                         (peer.uid, 'guesses.answer:' + owned_round['token'])) == [(1, 'null')],
              'Merge failed to scrub stale third-party Guess disclosure while retaining its replay guard')
        self.assert_error(self.answer(peer, owned_round, key=peer_answer_key, statuses=(409,)), 'idempotency_stale')
        self.assert_error(self.answer(peer, owned_round, 'B', key=peer_answer_key, statuses=(409,)), 'idempotency_conflict')
        assessment_count = self.scalar('SELECT count(*) FROM assessments')
        for expected, (body, key) in ((sa, source_assessment_request), (ta, target_assessment_request)):
            replay = source.request('POST', '/self/assessments', body, key=key)
            check(replay == expected, 'Merge lost immutable source or target Self retry response')
        check(self.scalar('SELECT count(*) FROM assessments') == assessment_count, 'Self replay duplicated assessments')
        check(source.request('GET', '/mirror?self_assessment_id=' + sa['id'])['completed_count'] == 1,
              'Transferred owned Friends cohort is unreadable')
        check(source.request('GET', '/mirror?self_assessment_id=' + ta['id'])['self_assessment_id'] == ta['id'],
              'Destination original assessment disappeared')
        unrelated.request('GET', '/mirror?self_assessment_id=' + sa['id'], statuses=(404,))
        hidden(unrelated.request('GET', '/guesses/' + owned_round['token']))
        hidden(source.request('GET', '/guesses/' + incoming_reverse['token']))
        unrelated.request('GET', '/guesses/' + incoming_reverse['token'], statuses=(403, 404))
        self.answer(source, incoming_reverse, 'B')
        self.answer(source, owned_round, statuses=(403,))
        self.respond(source, pending_invite, pending_session)
        source.request('GET', '/guesses/' + revoked_round['token'], statuses=(404, 410))
        source.request('GET', '/guesses/' + expired_round['token'], statuses=(404, 410))
        source.request('GET', '/invites/' + revoked_invite['token'], statuses=(404, 410))
        exported = source.request('GET', '/me/export')
        records = exported['records']
        check({sa['id'], ta['id']} <= {r['id'] for r in records['assessments']}, 'Export omits transferred Self')
        check({sp['id'], tp['id']} <= {r['id'] for r in records['pulse_answers']}, 'Export omits transferred Pulse')
        check(any(r['note'] == 'Synthetic retained note' for r in records['journal_notes']), 'Export lost journal note')
        encoded = json.dumps(exported)
        for forbidden in ('password_hash', 'csrf_token', 'session_hash', 'token_hash', 'merge_token'):
            check(forbidden not in encoded, 'Export leaked authentication or approval material')
        check(self.query('SELECT token FROM challenges WHERE owner_id=?', (source.uid,)) == [], 'Old owner references remain')
        # Deletion must handle the complete merged graph, including targeted
        # reverse invitations owned by another identity.
        source.request('DELETE', '/me', {'confirmation': 'DELETE', 'password': target.password}, statuses=(204,))
        check(target_session.request('GET', '/session')['user'] is None, 'Deletion left destination session active')
        check(unrelated.request('GET', '/self/latest')['id'] == unrelated_assessment['id'], 'Deletion removed unrelated data')
        peer.request('GET', '/guesses/' + owned_round['token'], statuses=(404, 410))
        peer.request('GET', '/guesses/' + incoming_reverse['token'], statuses=(404, 410))
        third_owner.request('GET', '/guesses/' + owned_reverse['token'], statuses=(404, 410))
        check(not self.query('PRAGMA foreign_key_check'), 'Merged-account deletion left broken references')

    def test_same_day_pulse_blocks_even_identical_choice(self):
        source, target = self.pair()
        self.pulse(source, 'A')
        target_pulse = self.pulse(target, 'A')
        self.blocked_preview(source, target, 'pulse_overlap')
        self.execute('UPDATE pulse_answers SET choice=? WHERE id=?', ('B', target_pulse['id']))
        self.blocked_preview(source, target, 'pulse_overlap')

    def test_duplicate_completed_friends_participation_blocks(self):
        source, target = self.pair()
        invite = self.invite(self.new())
        self.respond(source, invite)
        self.respond(target, invite)
        self.blocked_preview(source, target, 'friend_overlap')

    def test_duplicate_friend_reservations_block(self):
        source, target = self.pair()
        invite = self.invite(self.new())
        self.start(source, invite)
        self.start(target, invite)
        self.blocked_preview(source, target, 'friend_overlap')

    def test_friend_response_plus_reservation_blocks(self):
        source, target = self.pair()
        invite = self.invite(self.new())
        self.respond(source, invite)
        self.start(target, invite)
        self.blocked_preview(source, target, 'friend_overlap')

    def test_friends_across_reissued_links_still_conflict(self):
        source, target = self.pair()
        owner = self.new()
        assessment = self.assess(owner)
        first = self.invite(owner, assessment)
        self.respond(source, first)
        owner.request('DELETE', '/invites/' + first['token'], statuses=(204,))
        second = self.invite(owner, assessment)
        self.start(target, second)
        check(first['token'] != second['token'], 'Fixture did not reissue invitation')
        self.blocked_preview(source, target, 'friend_overlap')

    def test_cross_identity_friend_response_blocks_both_directions(self):
        for guest_is_owner in (True, False):
            source, target = self.pair()
            owner, respondent = (source, target) if guest_is_owner else (target, source)
            self.respond(respondent, self.invite(owner))
            self.blocked_preview(source, target, 'friend_self_interaction')

    def test_cross_identity_friend_reservation_blocks_both_directions(self):
        for guest_is_owner in (True, False):
            source, target = self.pair()
            owner, respondent = (source, target) if guest_is_owner else (target, source)
            self.start(respondent, self.invite(owner))
            self.blocked_preview(source, target, 'friend_self_interaction')

    def test_duplicate_guess_same_round_blocks(self):
        source, target = self.pair()
        challenge = self.challenge(self.new())
        self.answer(source, challenge)
        self.answer(target, challenge)
        self.blocked_preview(source, target, 'guess_overlap')

    def test_duplicate_guess_underlying_source_across_rounds_blocks(self):
        source, target = self.pair()
        owner = self.new()
        assessment = self.assess(owner)
        first = self.challenge(owner, assessment)
        self.answer(source, first, 'B')
        owner.request('DELETE', '/guesses/' + first['token'], statuses=(204,))
        second = self.challenge(owner, assessment)
        self.answer(target, second, 'A')
        check(first['token'] != second['token'], 'Fixture did not reissue Guess round')
        self.blocked_preview(source, target, 'guess_overlap')

    def test_cross_identity_guess_participation_blocks_both_directions(self):
        for guest_is_owner in (True, False):
            source, target = self.pair()
            owner, guesser = (source, target) if guest_is_owner else (target, source)
            self.answer(guesser, self.challenge(owner))
            self.blocked_preview(source, target, 'guess_self_interaction')

    def test_targeted_reverse_self_interaction_blocks_without_guess(self):
        source, target = self.pair()
        peer = self.new()
        challenge = self.challenge(peer)
        self.answer(target, challenge)
        reverse = target.request('POST', '/guesses/' + challenge['token'] + '/reverse', {'choice': 'B'})
        # Isolate target-reference detection from cross-identity guesses. No
        # participant has answered this targeted synthetic reverse round.
        self.execute('UPDATE challenges SET target_user_id=? WHERE token=?', (source.uid, reverse['token']))
        self.blocked_preview(source, target, 'reverse_self_target')

    def test_duplicate_reverse_parent_ownership_blocks(self):
        source, target = self.pair()
        parent = self.challenge(self.new())
        self.answer(source, parent)
        self.answer(target, parent)
        a = source.request('POST', '/guesses/' + parent['token'] + '/reverse', {'choice': 'A'})
        b = target.request('POST', '/guesses/' + parent['token'] + '/reverse', {'choice': 'B'})
        # Remove guesses only in this synthetic fixture to independently exercise
        # duplicate reverse-owner detection rather than duplicate guess detection.
        self.execute('DELETE FROM guesses WHERE challenge_token=?', (parent['token'],))
        check(a['token'] != b['token'], 'Fixture lacks distinct reverse rounds')
        self.blocked_preview(source, target, 'reverse_overlap')

    def test_same_request_key_across_identities_blocks_without_losing_retry_history(self):
        source, target = self.pair()
        shared_key = secrets.token_hex(16)
        self.assess(source, key=shared_key)
        self.assess(target, key=shared_key)
        result = self.blocked_preview(source, target)
        check(any(c['code'] == 'request_key_conflict' for c in result['conflicts']),
              'Request-key collision did not report its own strict conflict')

    def stale_after(self, mutate):
        source, target = self.pair()
        context = mutate(source, target, False)
        p = self.valid_preview(source, target)
        mutate(source, target, context)
        before = self.snapshot()
        self.assert_error(self.confirm(source, p['merge_token'], statuses=(409,)), 'merge_preview_stale')
        check(self.snapshot() == before, 'Stale preview partially merged data')
        check(source.request('GET', '/session')['user']['id'] == source.uid, 'Stale preview changed source session')
        check(target.request('GET', '/session')['user']['id'] == target.uid, 'Stale preview changed target session')

    def test_source_domain_change_invalidates_preview(self):
        self.stale_after(lambda s, t, ready: self.assess(s) if ready else True)

    def test_destination_domain_change_invalidates_preview(self):
        self.stale_after(lambda s, t, ready: self.assess(t) if ready else True)

    def test_source_profile_change_invalidates_preview(self):
        self.stale_after(lambda s, t, ready: s.request('PATCH', '/me', {'display_name': 'Changed guest'}) if ready else True)

    def test_destination_profile_change_invalidates_preview(self):
        self.stale_after(lambda s, t, ready: t.request('PATCH', '/me', {'display_name': 'Changed destination'}) if ready else True)

    def test_related_friend_response_invalidates_preview(self):
        def mutate(source, target, context):
            if context is False:
                return self.new(), self.invite(source)
            peer, invite = context
            self.respond(peer, invite)
        self.stale_after(mutate)

    def test_related_guess_participation_invalidates_preview(self):
        def mutate(source, target, context):
            if context is False:
                return self.new(), self.challenge(target)
            peer, challenge = context
            self.answer(peer, challenge)
        self.stale_after(mutate)

    def test_incoming_invitation_revocation_invalidates_preview(self):
        def mutate(source, target, context):
            if context is False:
                owner = self.new()
                invite = self.invite(owner)
                self.start(source, invite)
                return owner, invite
            owner, invite = context
            owner.request('DELETE', '/invites/' + invite['token'], statuses=(204,))
        self.stale_after(mutate)

    def test_incoming_completed_invitation_revocation_invalidates_preview(self):
        def mutate(source, target, context):
            if context is False:
                owner = self.new()
                invite = self.invite(owner)
                self.respond(source, invite)
                return owner, invite
            owner, invite = context
            owner.request('DELETE', '/invites/' + invite['token'], statuses=(204,))
        self.stale_after(mutate)

    def test_saved_question_snapshot_change_invalidates_preview(self):
        def mutate(source, target, context):
            if context is False:
                return self.pulse(source)
            saved = json.loads(self.scalar('SELECT question_json FROM pulse_answers WHERE id=?', (context['id'],)))
            saved['prompt'] = 'Synthetic changed snapshot after preview'
            self.execute('UPDATE pulse_answers SET question_json=? WHERE id=?', (json.dumps(saved), context['id']))
        self.stale_after(mutate)

    def test_unrelated_domain_activity_does_not_stale_preview(self):
        source, target = self.pair()
        outsider = self.new()
        p = self.valid_preview(source, target)
        self.assess(outsider)
        check(self.confirm(source, p['merge_token'])['user']['id'] == target.uid,
              'Unrelated user activity invalidated scoped merge fingerprint')

    def test_new_conflict_clears_previous_approval(self):
        source, target = self.pair()
        p = self.valid_preview(source, target)
        self.pulse(source)
        self.pulse(target)
        self.blocked_preview(source, target, 'pulse_overlap')
        self.assert_error(self.confirm(source, p['merge_token'], statuses=(409,)), 'merge_preview_expired')

    def test_concurrent_confirmation_transfers_exactly_once_and_replay_is_rejected(self):
        source, target = self.pair()
        assessment = self.assess(source)
        old_cookie = self.clone(source)
        p = self.valid_preview(source, target)
        clients = [self.clone(source) for _ in range(4)]
        def submit(client):
            return self.confirm(client, p['merge_token'], statuses=(200, 201, 401, 403, 409))
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(submit, clients))
        successes = [result for result in results if result.get('user')]
        check(len(successes) == 1, 'Concurrent confirmation succeeded other than exactly once')
        check(successes[0]['user']['id'] == target.uid, 'Concurrent merge selected wrong destination')
        check(self.scalar('SELECT count(*) FROM assessments WHERE id=? AND user_id=?',
                          (assessment['id'], target.uid)) == 1, 'Concurrent merge duplicated or lost an assessment')
        self.confirm(old_cookie, p['merge_token'], statuses=(401, 403, 409))
        self.confirm(target, p['merge_token'], statuses=(403, 409))
        check(self.scalar('SELECT count(*) FROM users WHERE id=?', (source.uid,)) == 0, 'Replay restored source identity')
        check(self.scalar('SELECT count(*) FROM merge_previews') == 0, 'Consumed approval remains usable')
        check(not self.query('PRAGMA foreign_key_check'), 'Concurrent merge left invalid references')

    def test_database_failure_rolls_back_entire_merge_and_token_can_retry(self):
        source, target = self.pair()
        self.assess(source)
        self.pulse(source)
        p = self.valid_preview(source, target)
        before = self.snapshot()
        approvals = self.rows('merge_previews')
        # Fail at source deletion, after transfer statements should have run.
        # Trigger lives only in this disposable DB and never touches production.
        self.execute("CREATE TRIGGER synthetic_merge_failure BEFORE DELETE ON users "
                     "WHEN OLD.kind='guest' BEGIN SELECT RAISE(ABORT, 'synthetic merge failure'); END")
        self.confirm(source, p['merge_token'], statuses=(500,))
        check(self.snapshot() == before, 'Database failure left a partial merge or invalidated sessions')
        check(self.rows('merge_previews') == approvals, 'Rollback consumed the approval token')
        self.execute('DROP TRIGGER synthetic_merge_failure')
        check(self.confirm(source, p['merge_token'])['user']['id'] == target.uid,
              'Merge could not retry the same approval after transactional rollback')
        check(not self.query('PRAGMA foreign_key_check'), 'Retried merge broke foreign keys')


@contextmanager
def isolated_backend(binary, requested_port):
    # Refuse an occupied port before HTTP activity. Neither the test runner nor a
    # case accepts a preexisting server URL or database path.
    with socket.socket() as probe:
        # A previous owned case can leave TIME_WAIT sockets on an explicitly
        # requested port. Reuse permits those, but not another live listener.
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind(('127.0.0.1', requested_port))
        port = probe.getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    with tempfile.TemporaryDirectory(prefix='nolya-merge-') as temp:
        db = Path(temp) / 'synthetic.sqlite'
        env = dict(os.environ, NOLYA_ENV='development', NOLYA_BIND=f'127.0.0.1:{port}', NOLYA_DB_PATH=str(db),
                   NOLYA_PUBLIC_ORIGIN=base, NOLYA_ALLOWED_ORIGINS=base,
                   NOLYA_COOKIE_SECURE='false', RUST_LOG='warn')
        with (Path(temp) / 'server.log').open('w+') as log:
            process = subprocess.Popen([str(binary)], cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                ready = False
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError('Isolated backend exited before readiness; no case executed.')
                    try:
                        with urllib.request.urlopen(base + '/api/v1/health', timeout=0.5) as response:
                            ready = response.status == 200
                    except (urllib.error.URLError, TimeoutError):
                        pass
                    if ready and db.is_file():
                        break
                    time.sleep(0.05)
                if not ready or process.poll() is not None or not db.is_file():
                    raise RuntimeError('Isolated backend did not become ready; no case executed.')
                yield base, str(db)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, default=ROOT / 'backend/target/debug/nolya-api')
    parser.add_argument('--port', type=int, default=0, help='Loopback port; default selects an unused port per case')
    parser.add_argument('--case', help='Run only case names containing this text')
    args = parser.parse_args()
    binary = args.binary.resolve()
    if not binary.is_file():
        parser.error('Backend binary is missing. Build backend/Cargo.toml first.')
    if not 0 <= args.port <= 65535:
        parser.error('Port must be between 0 and 65535.')
    names = [name for name in MergeTests.__dict__ if name.startswith('test_')
             and (args.case is None or args.case in name)]
    if not names:
        parser.error('No test case matches the requested filter.')
    failures = []
    for name in names:
        label = name.removeprefix('test_').replace('_', ' ')
        try:
            with isolated_backend(binary, args.port) as (base, db):
                getattr(MergeTests(base, db), name)()
            print('PASS:', label, flush=True)
        except Exception as exc:
            failures.append(name)
            # Client deliberately redacts bodies, tokens, and credentials.
            print('FAIL:', label, type(exc).__name__, str(exc), flush=True)
    print(f'SUMMARY: {len(names)} cases, {len(failures)} failures', flush=True)
    return int(bool(failures))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError) as exc:
        print('BLOCKED:', str(exc), file=sys.stderr)
        sys.exit(2)
