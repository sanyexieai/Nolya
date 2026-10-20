#!/usr/bin/env python3
"""Product/history/invitation regression tests; disposable loopback DBs only."""
import argparse
import secrets
import sys
from pathlib import Path
from merge_api import MergeTests, isolated_backend, check, ROOT

class ProductTests(MergeTests):
    def test_journal_filters_pagination_and_privacy(self):
        owner, other = self.new(), self.new()
        today=owner.request('GET','/pulse/today')
        import json
        for i in range(1,7):
            self.execute('INSERT INTO pulse_answers(id,user_id,day,question_id,question_json,version,region,choice,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(secrets.token_hex(16),owner.uid,f'2026-01-0{i}',today['question']['id'],json.dumps(today['question']),today['question']['version'],'CN','A' if i%2 else 'B',f'2026-01-0{i}T00:00:00.000Z'))
        page=owner.request('GET','/journal?from=2026-01-02&to=2026-01-06&choice=B&limit=2')
        check(page['total']==3 and [e['date'] for e in page['entries']]==['2026-01-06','2026-01-04'],'filter or order incorrect')
        next_page=owner.request('GET','/journal?from=2026-01-02&to=2026-01-06&choice=B&limit=2&cursor='+page['next_cursor'])
        check([e['date'] for e in next_page['entries']]==['2026-01-02'] and next_page['next_cursor'] is None,'pagination wrong')
        check(other.request('GET','/journal?from=2026-01-01')['total']==0,'private entries leaked')
        answer_id=next_page['entries'][0]['answer_id']
        entry=owner.request('GET','/journal/entries/'+answer_id)
        check(entry['date']=='2026-01-02' and entry['choice']=='B','specific old answer lookup wrong')
        other.request('GET','/journal/entries/'+answer_id,statuses=(404,))
        check(owner.request('GET','/journal?from=2026-02-01')['entries']==[],'empty filter wrong')
    def test_invalid_journal_filters(self):
        owner=self.new()
        for query in ['from=2026-02-30','to=2026-1-1','cursor=not-date','choice=C','from=2026-02-01&to=2026-01-01']:
            owner.request('GET','/journal?'+query,statuses=(400,422))
    def test_self_history_cursor_stability_and_idor(self):
        owner, other=self.new(), self.new()
        saved=[self.assess(owner) for _ in range(5)]
        # Force equal timestamps to check deterministic rowid ordering.
        self.execute("UPDATE assessments SET created_at='2026-01-01T00:00:00.000Z' WHERE user_id=?",(owner.uid,))
        first=owner.request('GET','/self/history?limit=2')
        check(first['total']==5 and len(first['assessments'])==2,'history total wrong')
        second=owner.request('GET','/self/history?limit=2&cursor='+first['next_cursor'])
        last=owner.request('GET','/self/history?limit=2&cursor='+second['next_cursor'])
        ids=[v['id'] for p in [first,second,last] for v in p['assessments']]
        check(len(ids)==len(set(ids))==5 and last['next_cursor'] is None,'history cursor duplicates or missing rows')
        other.request('GET','/self/history?cursor='+ids[0],statuses=(404,))
        check(other.request('GET','/self/history')['assessments']==[],'other history leaked')
    def test_invite_management_pagination_and_revoke(self):
        owner,other=self.new(),self.new()
        for _ in range(3):
            assessment=self.assess(owner)
            owner.request('POST','/invites',{'self_assessment_id':assessment['id']})
        one=owner.request('GET','/invites?limit=2')
        check(one['total']==3 and len(one['invites'])==2 and one['next_cursor'],'invitation pagination missing')
        two=owner.request('GET','/invites?limit=2&cursor='+one['next_cursor'])
        check(len(two['invites'])==1 and two['next_cursor'] is None,'invitation page2 wrong')
        token=one['invites'][0]['token']
        other.request('GET','/invites?cursor='+token,statuses=(404,))
        other.request('DELETE','/invites/'+token,statuses=(404,))
        owner.request('DELETE','/invites/'+token,statuses=(204,))
        check(owner.request('GET','/invites')['invites'][0]['status']=='revoked','revoke missing from management')
        other.request('GET','/invites/'+token,statuses=(410,))
    def test_guess_management_pagination_expiry_and_secrecy(self):
        owner,other=self.new(),self.new()
        assessment=self.assess(owner)
        for answer in assessment['answers'][:3]:
            owner.request('POST','/guesses',{'source_type':'self','answer_id':answer['id']})
        one=owner.request('GET','/guesses?limit=2')
        check(one['total']==3 and len(one['rounds'])==2,'guess list incorrect')
        two=owner.request('GET','/guesses?limit=2&cursor='+one['next_cursor'])
        check(len(two['rounds'])==1 and two['next_cursor'] is None,'guess cursor incorrect')
        token=one['rounds'][0]['token']
        other.request('GET','/guesses?cursor='+token,statuses=(404,))
        self.execute('UPDATE challenges SET expires_at=1 WHERE token=?',(token,))
        check(owner.request('GET','/guesses')['rounds'][0]['status']=='expired','expiry status missing')
        other.request('GET','/guesses/'+token,statuses=(410,))
        for row in one['rounds']:
            check('actual_choice' not in row and 'answer' not in row,'management exposes answer unnecessarily')
    def test_health_routes_and_missing_assets(self):
        owner=self.new()
        check(owner.request('GET','/health/live')['status']=='ok','liveness failed')
        check(owner.request('GET','/health/ready')['status']=='ready','readiness failed')
        owner.request('GET','/unknown',statuses=(404,))

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--binary',type=Path,default=ROOT/'backend/target/debug/nolya-api');args=p.parse_args()
    names=[n for n in ProductTests.__dict__ if n.startswith('test_')];failures=[]
    for name in names:
        try:
            with isolated_backend(args.binary.resolve(),0) as (base,db):getattr(ProductTests(base,db),name)()
            print('PASS:',name,flush=True)
        except Exception as e:
            failures.append(name);print('FAIL:',name,type(e).__name__,str(e),flush=True)
    print(f'SUMMARY: {len(names)} cases, {len(failures)} failures');return bool(failures)
if __name__=='__main__':sys.exit(main())
