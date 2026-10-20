use crate::{catalog, core::*};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateInput {
    source_type: String,
    answer_id: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChoiceInput {
    choice: Choice,
}
struct Round {
    owner: String,
    name: String,
    question: Value,
    answer: String,

    expires: i64,
    revoked: bool,
    target: Option<String>,
}
fn load(db: &Connection, token: &str) -> ApiResult<Round> {
    db.query_row("SELECT c.owner_id,u.display_name,c.question_json,c.answer,c.source,c.source_answer_id,c.expires_at,c.revoked,c.target_user_id FROM challenges c JOIN users u ON u.id=c.owner_id WHERE c.token=?1",[token],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,i64>(6)?,r.get::<_,bool>(7)?,r.get::<_,Option<String>>(8)?))).optional()?.map(|(owner,name,q,answer,_source,_source_id,expires,revoked,target)|Ok(Round{owner,name,question:serde_json::from_str(&q)?,answer,expires,revoked,target})).unwrap_or_else(||Err(ApiError::missing()))
}
fn valid(round: &Round) -> ApiResult<()> {
    if round.revoked {
        return Err(ApiError(
            StatusCode::GONE,
            "invite_revoked",
            "这轮猜测已撤回".into(),
        ));
    }
    if round.expires <= Utc::now().timestamp() {
        return Err(ApiError(
            StatusCode::GONE,
            "invite_expired",
            "这轮猜测已过期".into(),
        ));
    }
    Ok(())
}
fn target_allowed(round: &Round, user: &str) -> ApiResult<()> {
    if let Some(target) = &round.target {
        if target != user && round.owner != user {
            return Err(ApiError::missing());
        }
    }
    Ok(())
}
fn share(state: &AppState, token: &str, expires: i64, source: &str) -> Value {
    json!({"id":token,"token":token,"url":format!("{}/guess/{}",state.config.public_origin,token),"expires_at":DateTime::from_timestamp(expires,0).unwrap().to_rfc3339(),"source_type":source,"status":"active"})
}
fn reveal(db: &Connection, round: &Round, guesser: &str, choice: &str) -> ApiResult<Value> {
    // Reissuing a link for the same underlying answer never increases relationship evidence.
    let(correct,total):(i64,i64)=db.query_row("SELECT COALESCE(sum(correct),0),count(*) FROM (SELECT correct FROM (SELECT g.correct,row_number() OVER (PARTITION BY c.source_answer_id ORDER BY g.created_at,g.rowid) AS attempt FROM guesses g JOIN challenges c ON c.token=g.challenge_token WHERE c.owner_id=?1 AND g.guesser_id=?2) WHERE attempt=1)",params![round.owner,guesser],|r|Ok((r.get(0)?,r.get(1)?)))?;
    Ok(
        json!({"guessed_choice":choice,"actual_choice":round.answer,"correct":choice==round.answer,"relationship":{"correct_count":correct,"total_count":total,"display_mode":if total<3{"getting_started"}else if total<6{"counts"}else{"ratio"}},"can_reverse":!round.revoked&&round.expires>Utc::now().timestamp()}),
    )
}
pub async fn create(
    State(state): State<AppState>,
    auth: Auth,
    headers: HeaderMap,
    ApiJson(body): ApiJson<CreateInput>,
) -> ApiResult<Json<Value>> {
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let (key, fingerprint, prior) = idem_read(
        &tx,
        &auth,
        &headers,
        "guesses.create",
        &serde_json::to_value(&body)?,
    )?;
    if let Some(v) = prior {
        return Ok(Json(v));
    }
    let (q, answer) = if body.source_type == "pulse" {
        let saved: Option<(String, String)> = tx
            .query_row(
                "SELECT question_json,choice FROM pulse_answers WHERE id=?1 AND user_id=?2",
                params![body.answer_id, auth.user_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (q, a) = saved.ok_or_else(ApiError::missing)?;
        (serde_json::from_str::<catalog::Question>(&q)?, a)
    } else if body.source_type == "self" {
        let (assessment, qid) = body
            .answer_id
            .split_once(':')
            .ok_or_else(|| ApiError::bad("请选择已经保存的真实答案"))?;
        let saved: Option<String> = tx
            .query_row(
                "SELECT answers_json FROM assessments WHERE id=?1 AND user_id=?2 AND version='1.0'",
                params![assessment, auth.user_id],
                |r| r.get(0),
            )
            .optional()?;
        let answers: Vec<Answer> = serde_json::from_str(&saved.ok_or_else(ApiError::missing)?)?;
        let a = answers
            .iter()
            .find(|a| a.question_id == qid)
            .ok_or_else(ApiError::missing)?;
        (
            catalog::find(qid).ok_or_else(ApiError::missing)?,
            a.choice.as_str().to_owned(),
        )
    } else {
        return Err(ApiError::bad("答案来源必须是 self 或 pulse"));
    };
    let existing:Option<(String,i64)>=tx.query_row("SELECT token,expires_at FROM challenges WHERE owner_id=?1 AND source_answer_id=?2 AND revoked=0 AND expires_at>?3",params![auth.user_id,body.answer_id,Utc::now().timestamp()],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let (token, expires) = if let Some(pair) = existing {
        pair
    } else {
        let token = random_token();
        let expires = Utc::now().timestamp() + 7 * 86400;
        tx.execute("INSERT INTO challenges(token,owner_id,question_id,question_json,source_answer_id,answer,source,created_at,expires_at)VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![token,auth.user_id,q.id,serde_json::to_string(&q)?,body.answer_id,answer,body.source_type,now(),expires])?;
        (token, expires)
    };
    let result = share(&state, &token, expires, &body.source_type);
    idem_save(&tx, &auth, "guesses.create", &key, &fingerprint, &result)?;
    tx.commit()?;
    Ok(Json(result))
}
#[derive(Deserialize)]
pub struct ListQuery {
    limit: Option<usize>,
    cursor: Option<String>,
}
pub async fn list(
    State(state): State<AppState>,
    auth: Auth,
    Query(query): Query<ListQuery>,
) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let anchor: Option<i64> = if let Some(cursor) = query.cursor {
        Some(
            db.query_row(
                "SELECT rowid FROM challenges WHERE token=?1 AND owner_id=?2",
                params![cursor, auth.user_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(ApiError::missing)?,
        )
    } else {
        None
    };
    let mut stmt=db.prepare("SELECT token,expires_at,source,revoked,created_at,(SELECT count(*) FROM guesses g WHERE g.challenge_token=c.token) FROM challenges c WHERE owner_id=?1 AND (?2 IS NULL OR rowid<?2) ORDER BY rowid DESC LIMIT ?3")?;
    let rows = stmt
        .query_map(params![auth.user_id, anchor, (limit + 1) as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let more = rows.len() > limit;
    let out = rows
        .into_iter()
        .take(limit)
        .map(|(token, expires, source, revoked, created, n)| {
            let mut v = share(&state, &token, expires, &source);
            v["status"] = json!(if revoked {
                "revoked"
            } else if expires <= Utc::now().timestamp() {
                "expired"
            } else {
                "active"
            });
            v["created_at"] = json!(created);
            v["guess_count"] = json!(n);
            v
        })
        .collect::<Vec<_>>();
    let cursor = if more {
        out.last().map(|v| v["token"].clone())
    } else {
        None
    };
    let total: i64 = db.query_row(
        "SELECT count(*) FROM challenges WHERE owner_id=?1",
        [&auth.user_id],
        |r| r.get(0),
    )?;
    Ok(Json(
        json!({"rounds":out,"next_cursor":cursor,"total":total}),
    ))
}
pub async fn get(
    State(state): State<AppState>,
    Path(token): Path<String>,
    auth: Option<Extension<Auth>>,
) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    let round = load(&db, &token)?;
    valid(&round)?;
    let user = auth.as_ref().map(|a| a.0.user_id.as_str()).unwrap_or("");
    target_allowed(&round, user)?;
    let choice: Option<String> = db
        .query_row(
            "SELECT choice FROM guesses WHERE challenge_token=?1 AND guesser_id=?2",
            params![token, user],
            |r| r.get(0),
        )
        .optional()?;
    let result = choice
        .as_ref()
        .map(|c| reveal(&db, &round, user, c))
        .transpose()?;
    Ok(Json(
        json!({"id":token,"owner_display_name":round.name,"question":round.question,"status":if round.revoked{"revoked"}else if round.expires<=Utc::now().timestamp(){"expired"}else{"active"},"is_owner":user==round.owner,"already_guessed":choice.is_some(),"reveal":result}),
    ))
}
pub async fn answer(
    State(state): State<AppState>,
    auth: Auth,
    Path(token): Path<String>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<ChoiceInput>,
) -> ApiResult<Json<Value>> {
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let round = load(&tx, &token)?;
    valid(&round)?;
    target_allowed(&round, &auth.user_id)?;
    if round.owner == auth.user_id {
        return Err(ApiError::forbidden("不能猜自己的答案"));
    }
    let scope = format!("guesses.answer:{token}");
    let (key, fingerprint, prior) =
        idem_read(&tx, &auth, &headers, &scope, &serde_json::to_value(&body)?)?;
    if let Some(v) = prior {
        return Ok(Json(v));
    }
    let existing: Option<String> = tx
        .query_row(
            "SELECT choice FROM guesses WHERE challenge_token=?1 AND guesser_id=?2",
            params![token, auth.user_id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(old) = existing {
        if old != body.choice.as_str() {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "already_submitted",
                "猜测已提交，不能看到答案后改选".into(),
            ));
        }
    } else {
        tx.execute(
            "INSERT INTO guesses VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                id(),
                token,
                auth.user_id,
                body.choice.as_str(),
                body.choice.as_str() == round.answer,
                now()
            ],
        )?;
        event(&tx, &auth.user_id, "guess_completed")?;
    }
    let result = reveal(&tx, &round, &auth.user_id, body.choice.as_str())?;
    idem_save(&tx, &auth, &scope, &key, &fingerprint, &result)?;
    tx.commit()?;
    Ok(Json(result))
}
pub async fn reverse(
    State(state): State<AppState>,
    auth: Auth,
    Path(token): Path<String>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<ChoiceInput>,
) -> ApiResult<Json<Value>> {
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let parent = load(&tx, &token)?;
    valid(&parent)?;
    target_allowed(&parent, &auth.user_id)?;
    let participated: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM guesses WHERE challenge_token=?1 AND guesser_id=?2)",
        params![token, auth.user_id],
        |r| r.get(0),
    )?;
    if !participated {
        return Err(ApiError::forbidden("先完成这轮猜测，再邀请对方猜你"));
    }
    let scope = format!("guesses.reverse:{token}");
    let (key, fingerprint, prior) =
        idem_read(&tx, &auth, &headers, &scope, &serde_json::to_value(&body)?)?;
    if let Some(v) = prior {
        return Ok(Json(v));
    }
    let existing: Option<(String, i64, String)> = tx
        .query_row(
            "SELECT token,expires_at,answer FROM challenges WHERE parent_token=?1 AND owner_id=?2",
            params![token, auth.user_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (new_token, expires) = if let Some((token, expires, answer)) = existing {
        if answer != body.choice.as_str() {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "already_answered",
                "反向邀请的真实答案已保存，不能修改".into(),
            ));
        }
        (token, expires)
    } else {
        let new_token = random_token();
        let expires = Utc::now().timestamp() + 7 * 86400;
        let source_id = format!("reverse:{token}:{}", auth.user_id);
        tx.execute("INSERT INTO challenges(token,owner_id,question_id,question_json,source_answer_id,answer,source,parent_token,target_user_id,created_at,expires_at)VALUES(?1,?2,?3,?4,?5,?6,'reverse',?7,?8,?9,?10)",params![new_token,auth.user_id,parent.question["id"].as_str().unwrap(),parent.question.to_string(),source_id,body.choice.as_str(),token,parent.owner,now(),expires])?;
        (new_token, expires)
    };
    let result = share(&state, &new_token, expires, "reverse");
    idem_save(&tx, &auth, &scope, &key, &fingerprint, &result)?;
    tx.commit()?;
    Ok(Json(result))
}
pub async fn revoke(
    State(state): State<AppState>,
    auth: Auth,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> ApiResult<StatusCode> {
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let round = load(&tx, &token)?;
    if round.owner != auth.user_id {
        return Err(ApiError::missing());
    }
    let scope = format!("guesses.delete:{token}");
    let (key, fingerprint, prior) = idem_read(&tx, &auth, &headers, &scope, &Value::Null)?;
    if prior.is_none() {
        tx.execute("UPDATE challenges SET revoked=1 WHERE token=?1", [token])?;
        idem_save(&tx, &auth, &scope, &key, &fingerprint, &Value::Null)?;
    }
    tx.commit()?;
    Ok(StatusCode::NO_CONTENT)
}
