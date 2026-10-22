//! Explicit, conflict-free guest adoption. Never guess which of two records to discard.
use crate::{auth, core::*};
use axum::{
    extract::State,
    http::{header::SET_COOKIE, HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmInput {
    merge_token: String,
    confirmation: String,
}

fn guest_session(db: &Connection, auth: &Auth) -> ApiResult<()> {
    auth::require_live_session(db, auth)?;
    let guest: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='guest')",
        [&auth.user_id],
        |r| r.get(0),
    )?;
    if !guest {
        return Err(ApiError::conflict("只能从当前访客空间发起合并"));
    }
    Ok(())
}

fn expired() -> ApiError {
    ApiError(
        StatusCode::CONFLICT,
        "merge_preview_expired",
        "合并预览已失效，请重新验证账户并查看预览".into(),
    )
}
fn stale() -> ApiError {
    ApiError(
        StatusCode::CONFLICT,
        "merge_preview_stale",
        "两个空间的记录已变化，请重新验证账户并查看最新预览".into(),
    )
}

fn summary(db: &Connection, source: &str) -> ApiResult<Value> {
    let mut out = serde_json::Map::new();
    for (name, sql) in [
        ("self_assessments", "SELECT count(*) FROM assessments WHERE user_id=?1"),
        ("pulse_answers", "SELECT count(*) FROM pulse_answers WHERE user_id=?1"),
        ("friend_responses", "SELECT count(*) FROM friend_responses WHERE respondent_id=?1"),
        ("friend_reservations", "SELECT count(*) FROM friend_assignments a WHERE respondent_id=?1 AND NOT EXISTS(SELECT 1 FROM friend_responses r WHERE r.invite_token=a.invite_token AND r.respondent_id=a.respondent_id)"),
        ("friend_invites", "SELECT count(*) FROM friend_invites WHERE user_id=?1"),
        ("guesses", "SELECT count(*) FROM guesses WHERE guesser_id=?1"),
        ("guess_links", "SELECT count(*) FROM challenges WHERE owner_id=?1"),
    ] {
        let n: i64 = db.query_row(sql, [source], |r| r.get(0))?;
        out.insert(name.into(), json!(n));
    }
    Ok(Value::Object(out))
}

fn conflicts(db: &Connection, source: &str, target: &str) -> ApiResult<Vec<Value>> {
    let mut out = vec![];
    for (code, message, sql) in [
        ("pulse_overlap", "两个空间在同一日期已有每日选择，不能覆盖或重复计票；请保留独立空间", "SELECT count(*) FROM pulse_answers s JOIN pulse_answers t ON t.day=s.day WHERE s.user_id=?1 AND t.user_id=?2"),
        ("friend_overlap", "两个身份参与或预约了同一份朋友镜像，不能合并为重复参与者", "WITH participation AS (SELECT assessment_id,respondent_id FROM friend_responses UNION SELECT i.assessment_id,a.respondent_id FROM friend_assignments a JOIN friend_invites i ON i.token=a.invite_token) SELECT count(*) FROM participation s JOIN participation t ON t.assessment_id=s.assessment_id WHERE s.respondent_id=?1 AND t.respondent_id=?2"),
        ("friend_self_interaction", "两个空间之间已有朋友回答或预约，合并会变成自己评价自己", "SELECT count(*) FROM (SELECT r.assessment_id,r.respondent_id FROM friend_responses r JOIN assessments a ON a.id=r.assessment_id WHERE (r.respondent_id=?1 AND a.user_id=?2) OR (r.respondent_id=?2 AND a.user_id=?1) UNION SELECT i.assessment_id,a.respondent_id FROM friend_assignments a JOIN friend_invites i ON i.token=a.invite_token WHERE (a.respondent_id=?1 AND i.user_id=?2) OR (a.respondent_id=?2 AND i.user_id=?1))"),
        ("guess_overlap", "两个身份已经猜过同一人的同一个保存答案，不能合并或选择更有利的成绩", "SELECT count(*) FROM (SELECT c.owner_id,c.source_answer_id FROM guesses g JOIN challenges c ON c.token=g.challenge_token WHERE g.guesser_id=?1 INTERSECT SELECT c.owner_id,c.source_answer_id FROM guesses g JOIN challenges c ON c.token=g.challenge_token WHERE g.guesser_id=?2)"),
        ("guess_self_interaction", "两个空间之间已有猜测，合并会变成自己猜自己的答案", "SELECT count(*) FROM guesses g JOIN challenges c ON c.token=g.challenge_token WHERE (g.guesser_id=?1 AND c.owner_id=?2) OR (g.guesser_id=?2 AND c.owner_id=?1)"),
        ("reverse_self_target", "两个空间之间已有定向反向邀请，合并会使邀请指向自己", "SELECT count(*) FROM challenges WHERE (owner_id=?1 AND target_user_id=?2) OR (owner_id=?2 AND target_user_id=?1)"),
        ("reverse_overlap", "两个身份已为同一轮猜测创建反向邀请，不能合并为重复来源", "SELECT count(*) FROM (SELECT parent_token FROM challenges WHERE owner_id=?1 AND parent_token IS NOT NULL INTERSECT SELECT parent_token FROM challenges WHERE owner_id=?2 AND parent_token IS NOT NULL)"),
        ("request_key_conflict", "两个空间有重复的请求标识，无法安全保留重试记录；请保留独立空间", "SELECT count(*) FROM idempotency_keys s JOIN idempotency_keys t ON t.scope=s.scope AND t.key=s.key WHERE s.user_id=?1 AND t.user_id=?2"),
    ] {
        let n: i64 = db.query_row(sql, params![source,target], |r| r.get(0))?;
        if n > 0 { out.push(json!({"code":code,"count":n,"message":message})); }
    }
    Ok(out)
}

// Ordered, typed serialization avoids concatenation ambiguity and includes incoming
// participation. A friend's new response can change what the user is consenting to.
fn fingerprint(db: &Connection, source: &str, target: &str) -> ApiResult<String> {
    let mut snapshot = vec![];
    for (table, filter) in [
        ("users", "id IN (?1,?2)"),
        ("assessments", "user_id IN (?1,?2)"),
        ("self_feedback", "user_id IN (?1,?2)"),
        ("pulse_answers", "user_id IN (?1,?2)"),
        ("journal_notes", "user_id IN (?1,?2)"),
        ("friend_invites", "user_id IN (?1,?2) OR token IN (SELECT invite_token FROM friend_assignments WHERE respondent_id IN (?1,?2) UNION SELECT invite_token FROM friend_responses WHERE respondent_id IN (?1,?2))"),
        ("friend_assignments", "respondent_id IN (?1,?2) OR invite_token IN (SELECT token FROM friend_invites WHERE user_id IN (?1,?2))"),
        ("friend_responses", "respondent_id IN (?1,?2) OR assessment_id IN (SELECT id FROM assessments WHERE user_id IN (?1,?2))"),
        ("challenges", "owner_id IN (?1,?2) OR target_user_id IN (?1,?2) OR token IN (SELECT challenge_token FROM guesses WHERE guesser_id IN (?1,?2))"),
        ("guesses", "guesser_id IN (?1,?2) OR challenge_token IN (SELECT token FROM challenges WHERE owner_id IN (?1,?2))"),
        ("idempotency_keys", "user_id IN (?1,?2)"),
        ("analytics_events", "user_id IN (?1,?2)"),
    ] {
        let mut stmt = db.prepare(&format!("SELECT * FROM {table} WHERE {filter} ORDER BY rowid"))?;
        let width = stmt.column_count();
        let rows = stmt.query_map(params![source,target], |r| {
            let mut values = vec![];
            for i in 0..width {
                let v = match r.get_ref(i)? {
                    rusqlite::types::ValueRef::Null => Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => json!(n),
                    rusqlite::types::ValueRef::Real(n) => json!(n),
                    rusqlite::types::ValueRef::Text(s) => json!(String::from_utf8_lossy(s)),
                    rusqlite::types::ValueRef::Blob(b) => json!(b),
                };
                values.push(v);
            }
            Ok(values)
        })?.collect::<Result<Vec<_>,_>>()?;
        snapshot.push(json!([table,rows]));
    }
    Ok(hash(&serde_json::to_string(&snapshot)?))
}

pub async fn preview(
    State(state): State<AppState>,
    auth: Auth,
    ApiJson(body): ApiJson<auth::LoginInput>,
) -> ApiResult<Json<Value>> {
    {
        let db = state.db.lock().expect("db");
        guest_session(&db, &auth)?;
    }
    let (target, verified_hash) = auth::verify_credentials(&state, body).await?;
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    // Password verification yields; both accounts and the source session must still exist.
    guest_session(&tx, &auth)?;
    let verified: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='registered' AND password_hash=?2)",
        params![target, verified_hash],
        |r| r.get(0),
    )?;
    if !verified {
        return Err(ApiError::unauthorized());
    }
    let target_user = user_json(&tx, &target)?;
    let conflicts = conflicts(&tx, &auth.user_id, &target)?;
    let counts = summary(&tx, &auth.user_id)?;
    tx.execute(
        "DELETE FROM merge_previews WHERE session_hash=?1 OR expires_at<=?2",
        params![auth.token_hash, Utc::now().timestamp()],
    )?;
    let mut token = None;
    let mut expires_at = None;
    if conflicts.is_empty() {
        let raw = random_token();
        let expires = Utc::now().timestamp() + 300;
        tx.execute("INSERT INTO merge_previews(token_hash,session_hash,source_user_id,target_user_id,fingerprint,expires_at) VALUES(?1,?2,?3,?4,?5,?6)",params![hash(&raw),auth.token_hash,auth.user_id,target,fingerprint(&tx,&auth.user_id,&target)?,expires])?;
        token = Some(raw);
        expires_at = Some(
            DateTime::from_timestamp(expires, 0)
                .expect("valid time")
                .to_rfc3339(),
        );
    }
    let result = json!({"can_merge":conflicts.is_empty(),"merge_token":token,"expires_at":expires_at,
        "target":{"username":target_user["username"],"display_name":target_user["display_name"]},
        "summary":counts,"conflicts":conflicts,
        "notice":"仅支持无冲突的完整合并。确认后访客记录和分享链接归入此账户，链接显示此账户昵称；此账户的设置不变，原访客会话全部失效。存在冲突时两个空间原样保留。"});
    tx.commit()?;
    Ok(Json(result))
}

fn transfer(db: &Connection, source: &str, target: &str) -> ApiResult<()> {
    // Retain replay guards but scrub stale response bodies, including peer disclosures.
    // Immutable self.create snapshots are still correct after ownership moves.
    db.execute("UPDATE idempotency_keys SET response_json='null',invalidated=1 WHERE (user_id IN (?1,?2) AND scope<>'self.create') OR scope IN (SELECT 'guesses.answer:'||token FROM challenges WHERE owner_id IN (?1,?2) OR target_user_id IN (?1,?2) UNION SELECT 'guesses.reverse:'||token FROM challenges WHERE owner_id IN (?1,?2) OR target_user_id IN (?1,?2) UNION SELECT 'guesses.delete:'||token FROM challenges WHERE owner_id IN (?1,?2) OR target_user_id IN (?1,?2) UNION SELECT 'invites.start:'||token FROM friend_invites WHERE user_id IN (?1,?2) UNION SELECT 'invites.responses:'||token FROM friend_invites WHERE user_id IN (?1,?2) UNION SELECT 'invites.delete:'||token FROM friend_invites WHERE user_id IN (?1,?2))",params![source,target])?;
    for (table, column) in [
        ("assessments", "user_id"),
        ("self_feedback", "user_id"),
        ("pulse_answers", "user_id"),
        ("journal_notes", "user_id"),
        ("friend_invites", "user_id"),
        ("friend_assignments", "respondent_id"),
        ("friend_responses", "respondent_id"),
        ("guesses", "guesser_id"),
        ("challenges", "owner_id"),
        ("challenges", "target_user_id"),
        ("idempotency_keys", "user_id"),
        ("analytics_events", "user_id"),
    ] {
        db.execute(
            &format!("UPDATE {table} SET {column}=?2 WHERE {column}=?1"),
            params![source, target],
        )?;
    }
    // Cascades remove all source sessions and approvals, including this consumed token.
    db.execute("DELETE FROM users WHERE id=?1", [source])?;
    event(db, target, "guest_merge_completed")?;
    Ok(())
}

pub async fn confirm(
    State(state): State<AppState>,
    auth: Auth,
    ApiJson(body): ApiJson<ConfirmInput>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    if body.confirmation != "MERGE" {
        return Err(ApiError::bad("需要明确确认合并"));
    }
    if body.merge_token.len() != 64 || !body.merge_token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(expired());
    }
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    guest_session(&tx, &auth)?;
    let approval: Option<(String,String)> = tx.query_row("SELECT target_user_id,fingerprint FROM merge_previews WHERE token_hash=?1 AND session_hash=?2 AND source_user_id=?3 AND expires_at>?4",params![hash(&body.merge_token),auth.token_hash,auth.user_id,Utc::now().timestamp()],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let (target, expected) = approval.ok_or_else(expired)?;
    let registered: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='registered')",
        [&target],
        |r| r.get(0),
    )?;
    if !registered
        || fingerprint(&tx, &auth.user_id, &target)? != expected
        || !conflicts(&tx, &auth.user_id, &target)?.is_empty()
    {
        return Err(stale());
    }
    transfer(&tx, &auth.user_id, &target)?;
    let (session, cookie) = issue_session(&tx, &state, &target)?;
    tx.commit()?;
    let mut headers = HeaderMap::new();
    headers.insert(SET_COOKIE, cookie);
    Ok((headers, Json(session)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn users(db: &Connection) {
        db.execute("INSERT INTO users(id,kind,username,created_at) VALUES('guest','guest',NULL,'2026-10-20'),('account','registered','account','2026-10-19'),('peer','guest',NULL,'2026-10-18')", []).unwrap();
    }
    fn cache(db: &Connection, user: &str, scope: &str, key: &str) {
        db.execute("INSERT INTO idempotency_keys(user_id,scope,key,fingerprint,response_json,created_at) VALUES(?1,?2,?3,'fingerprint','{\"saved\":true}','2026-10-20')", params![user,scope,key]).unwrap();
    }

    #[test]
    fn migration_upgrades_v1_without_losing_replays_and_reopens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("old.sqlite");
        let db = Connection::open(&path).unwrap();
        db.execute_batch(include_str!("../migrations/001_initial.sql"))
            .unwrap();
        users(&db);
        cache(&db, "guest", "self.create", "preserved-request");
        drop(db);
        let state = AppState::open(&path, AppConfig::default()).unwrap();
        assert_eq!(
            state
                .db
                .lock()
                .unwrap()
                .query_row("SELECT invalidated FROM idempotency_keys", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        drop(state);
        let state = AppState::open(&path, AppConfig::default()).unwrap();
        assert_eq!(
            state
                .db
                .lock()
                .unwrap()
                .query_row(
                    "SELECT count(*) FROM schema_migrations WHERE version=2",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn fingerprint_tracks_both_accounts_and_incoming_links_only() {
        let state = AppState::open(":memory:", AppConfig::default()).unwrap();
        let db = state.db.lock().unwrap();
        users(&db);
        let before = fingerprint(&db, "guest", "account").unwrap();
        db.execute(
            "UPDATE users SET display_name='unrelated' WHERE id='peer'",
            [],
        )
        .unwrap();
        assert_eq!(before, fingerprint(&db, "guest", "account").unwrap());
        db.execute(
            "UPDATE users SET display_name='updated' WHERE id='account'",
            [],
        )
        .unwrap();
        let changed = fingerprint(&db, "guest", "account").unwrap();
        assert_ne!(before, changed);
        db.execute("INSERT INTO challenges(token,owner_id,question_id,question_json,source_answer_id,answer,source,target_user_id,created_at,expires_at) VALUES('reverse','peer','q','{}','source','A','reverse','guest','2026-10-20',9999999999)",[]).unwrap();
        assert_ne!(changed, fingerprint(&db, "guest", "account").unwrap());
    }

    #[test]
    fn transfer_retains_self_replays_and_scrubs_only_affected_cache_bodies() {
        let state = AppState::open(":memory:", AppConfig::default()).unwrap();
        let mut db = state.db.lock().unwrap();
        users(&db);
        cache(&db, "guest", "self.create", "guest-self-request");
        cache(&db, "account", "self.create", "account-self-request");
        cache(&db, "guest", "guesses.create", "guest-link-request");
        cache(&db, "peer", "self.create", "unrelated-request");
        db.execute("INSERT INTO challenges(token,owner_id,question_id,question_json,source_answer_id,answer,source,created_at,expires_at) VALUES('link','guest','q','{}','source','A','reverse','2026-10-20',9999999999)",[]).unwrap();
        cache(&db, "peer", "guesses.answer:link", "peer-reveal-request");
        db.execute(
            "INSERT INTO sessions VALUES('old-session','guest','csrf',9999999999,'2026-10-20')",
            [],
        )
        .unwrap();
        let tx = db.transaction().unwrap();
        transfer(&tx, "guest", "account").unwrap();
        tx.commit().unwrap();
        assert_eq!(db.query_row("SELECT count(*) FROM idempotency_keys WHERE user_id='account' AND scope='self.create' AND invalidated=0",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        assert_eq!(db.query_row("SELECT count(*) FROM idempotency_keys WHERE invalidated=1 AND response_json='null'",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        assert_eq!(
            db.query_row(
                "SELECT invalidated FROM idempotency_keys WHERE key='unrelated-request'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            db.query_row("SELECT count(*) FROM users WHERE id='guest'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT count(*) FROM sessions WHERE user_id='guest'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        assert_eq!(
            db.query_row(
                "SELECT owner_id FROM challenges WHERE token='link'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "account"
        );
        assert!(!db
            .prepare("PRAGMA foreign_key_check")
            .unwrap()
            .exists([])
            .unwrap());
    }

    #[test]
    fn identical_daily_answers_and_request_key_collisions_still_block() {
        let state = AppState::open(":memory:", AppConfig::default()).unwrap();
        let db = state.db.lock().unwrap();
        users(&db);
        for user in ["guest", "account"] {
            db.execute("INSERT INTO pulse_answers(id,user_id,day,question_id,question_json,version,choice,created_at) VALUES(?1,?1,'2026-10-20','q','{}','1.0','A','2026-10-20')",[user]).unwrap();
            cache(&db, user, "self.create", "same-request-key");
        }
        let issues = conflicts(&db, "guest", "account").unwrap();
        assert!(issues
            .iter()
            .any(|x| x["code"] == "pulse_overlap" && x["count"] == 1));
        assert!(issues
            .iter()
            .any(|x| x["code"] == "request_key_conflict" && x["count"] == 1));
        assert_eq!(
            db.query_row("SELECT count(*) FROM pulse_answers", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
}
