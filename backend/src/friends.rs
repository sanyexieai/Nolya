use crate::{catalog, core::*, self_profile};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InviteInput {
    self_assessment_id: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StartInput {
    consent: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResponseInput {
    session_id: String,
    answers: Vec<Answer>,
}
#[derive(Deserialize)]
pub struct MirrorQuery {
    self_assessment_id: Option<String>,
}
struct Invite {
    owner: String,
    assessment: String,
    name: String,
    expires: i64,
    revoked: bool,
}
fn load(db: &Connection, token: &str) -> ApiResult<Invite> {
    db.query_row("SELECT i.user_id,i.assessment_id,u.display_name,i.expires_at,i.revoked FROM friend_invites i JOIN users u ON u.id=i.user_id WHERE token=?1",[token],|r|Ok(Invite{owner:r.get(0)?,assessment:r.get(1)?,name:r.get(2)?,expires:r.get(3)?,revoked:r.get(4)?})).optional()?.ok_or_else(ApiError::missing)
}
fn count(db: &Connection, assessment: &str) -> ApiResult<i64> {
    Ok(db.query_row(
        "SELECT count(*) FROM friend_responses WHERE assessment_id=?1",
        [assessment],
        |r| r.get(0),
    )?)
}
fn valid(invite: &Invite) -> ApiResult<()> {
    if invite.revoked {
        return Err(ApiError(
            StatusCode::GONE,
            "invite_revoked",
            "邀请已撤回".into(),
        ));
    }
    if invite.expires <= Utc::now().timestamp() {
        return Err(ApiError(
            StatusCode::GONE,
            "invite_expired",
            "邀请已过期".into(),
        ));
    }
    Ok(())
}
fn share(state: &AppState, token: &str, expires: i64, n: i64) -> Value {
    json!({"id":token,"token":token,"url":format!("{}/friend/{}",state.config.public_origin,token),"expires_at":DateTime::from_timestamp(expires,0).unwrap().to_rfc3339(),"type":"friends","completed_count":n,"max_respondents":3})
}
pub async fn create(
    State(state): State<AppState>,
    auth: Auth,
    headers: HeaderMap,
    ApiJson(body): ApiJson<InviteInput>,
) -> ApiResult<Json<Value>> {
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    self_profile::assessment_json(&tx, &body.self_assessment_id, &auth.user_id)?;
    let (key, fingerprint, prior) = idem_read(
        &tx,
        &auth,
        &headers,
        "invites.create",
        &serde_json::to_value(&body)?,
    )?;
    if let Some(v) = prior {
        return Ok(Json(v));
    }
    let existing:Option<(String,i64)>=tx.query_row("SELECT token,expires_at FROM friend_invites WHERE assessment_id=?1 AND revoked=0 AND expires_at>?2 ORDER BY created_at DESC LIMIT 1",params![body.self_assessment_id,Utc::now().timestamp()],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let (token, expires) = if let Some(pair) = existing {
        pair
    } else {
        let token = random_token();
        let expires = Utc::now().timestamp() + 7 * 86400;
        tx.execute(
            "INSERT INTO friend_invites VALUES(?1,?2,?3,?4,?5,0)",
            params![token, auth.user_id, body.self_assessment_id, now(), expires],
        )?;
        (token, expires)
    };
    let result = share(
        &state,
        &token,
        expires,
        count(&tx, &body.self_assessment_id)?,
    );
    idem_save(&tx, &auth, "invites.create", &key, &fingerprint, &result)?;
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
                "SELECT rowid FROM friend_invites WHERE token=?1 AND user_id=?2",
                params![cursor, auth.user_id],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(ApiError::missing)?,
        )
    } else {
        None
    };
    let mut stmt=db.prepare("SELECT token,assessment_id,expires_at,revoked,created_at FROM friend_invites WHERE user_id=?1 AND (?2 IS NULL OR rowid<?2) ORDER BY rowid DESC LIMIT ?3")?;
    let rows = stmt
        .query_map(params![auth.user_id, anchor, (limit + 1) as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, bool>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let more = rows.len() > limit;
    let mut out = vec![];
    for (token, assessment, expires, revoked, created) in rows.into_iter().take(limit) {
        let mut v = share(&state, &token, expires, count(&db, &assessment)?);
        v["self_assessment_id"] = json!(assessment);
        v["created_at"] = json!(created);
        v["status"] = json!(if revoked {
            "revoked"
        } else if expires <= Utc::now().timestamp() {
            "expired"
        } else {
            "active"
        });
        out.push(v);
    }
    let cursor = if more {
        out.last().map(|v| v["token"].clone())
    } else {
        None
    };
    let total: i64 = db.query_row(
        "SELECT count(*) FROM friend_invites WHERE user_id=?1",
        [&auth.user_id],
        |r| r.get(0),
    )?;
    Ok(Json(
        json!({"invites":out,"next_cursor":cursor,"total":total}),
    ))
}
pub async fn get(
    State(state): State<AppState>,
    Path(token): Path<String>,
    auth: Option<Extension<Auth>>,
) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    let invite = load(&db, &token)?;
    valid(&invite)?;
    let n = count(&db, &invite.assessment)?;
    let current = auth.as_ref().map(|a| a.0.user_id.as_str()).unwrap_or("");
    let submitted: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM friend_responses WHERE assessment_id=?1 AND respondent_id=?2)",
        params![invite.assessment, current],
        |r| r.get(0),
    )?;
    Ok(Json(
        json!({"type":"friends","owner_display_name":invite.name,"status":if invite.revoked{"revoked"}else if invite.expires<=Utc::now().timestamp(){"expired"}else if n>=3{"full"}else{"active"},"completed_count":n,"max_respondents":3,"already_submitted":submitted,"is_owner":current==invite.owner,"privacy_notice":"你的 3 个结构化选择会汇总给邀请人。只有一位参与者时，TA 仍可能看出这位参与者的观点；这里不承诺匿名。"}),
    ))
}
pub async fn start(
    State(state): State<AppState>,
    auth: Auth,
    Path(token): Path<String>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<StartInput>,
) -> ApiResult<Json<Value>> {
    if !body.consent {
        return Err(ApiError::bad("需要同意发送结构化反馈后参与"));
    }
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let invite = load(&tx, &token)?;
    valid(&invite)?;
    if invite.owner == auth.user_id {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "self_response_forbidden",
            "不能回答自己的朋友邀请".into(),
        ));
    }
    let scope = format!("invites.start:{token}");
    let (key, fingerprint, prior) =
        idem_read(&tx, &auth, &headers, &scope, &serde_json::to_value(&body)?)?;
    if let Some(v) = prior {
        return Ok(Json(v));
    }
    let existing:Option<(String,String)>=tx.query_row("SELECT session_id,questions_json FROM friend_assignments WHERE invite_token=?1 AND respondent_id=?2",params![token,auth.user_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
    let submitted: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM friend_responses WHERE assessment_id=?1 AND respondent_id=?2)",
        params![invite.assessment, auth.user_id],
        |r| r.get(0),
    )?;
    let (session, questions) = if let Some((session, qs)) = existing {
        (session, serde_json::from_str::<Value>(&qs)?)
    } else {
        if submitted {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "already_submitted",
                "你已经回应过这份观察".into(),
            ));
        }
        if count(&tx, &invite.assessment)? >= 3 {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "cohort_full",
                "已收到三份反馈".into(),
            ));
        }
        // Reclaim abandoned unsubmitted reservations after 30 minutes, across link recreations.
        let cutoff = (Utc::now() - chrono::Duration::minutes(30))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        tx.execute("DELETE FROM idempotency_keys WHERE EXISTS(SELECT 1 FROM friend_assignments a JOIN friend_invites i ON i.token=a.invite_token WHERE i.assessment_id=?1 AND a.created_at<?2 AND a.respondent_id NOT IN(SELECT respondent_id FROM friend_responses WHERE assessment_id=?1) AND idempotency_keys.user_id=a.respondent_id AND idempotency_keys.scope='invites.start:'||a.invite_token)",params![invite.assessment,cutoff])?;
        tx.execute("DELETE FROM friend_assignments WHERE invite_token IN(SELECT token FROM friend_invites WHERE assessment_id=?1) AND created_at<?2 AND respondent_id NOT IN(SELECT respondent_id FROM friend_responses WHERE assessment_id=?1)",params![invite.assessment,cutoff])?;
        let mut stmt=tx.prepare("SELECT DISTINCT a.variant FROM friend_assignments a JOIN friend_invites i ON i.token=a.invite_token WHERE i.assessment_id=?1")?;
        let used = stmt
            .query_map([&invite.assessment], |r| r.get::<_, usize>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        let variant = (0..3).find(|v| !used.contains(v)).ok_or_else(|| {
            ApiError(
                StatusCode::CONFLICT,
                "cohort_full",
                "三位朋友正在回答，请稍后再试".into(),
            )
        })?;
        let targets: String = tx.query_row(
            "SELECT target_dimensions_json FROM assessments WHERE id=?1",
            [&invite.assessment],
            |r| r.get(0),
        )?;
        let qs = serde_json::to_value(catalog::friend_questions(
            &serde_json::from_str::<Vec<String>>(&targets)?,
            variant,
        ))?;
        let session = id();
        tx.execute("INSERT INTO friend_assignments(invite_token,respondent_id,session_id,variant,questions_json,created_at)VALUES(?1,?2,?3,?4,?5,?6)",params![token,auth.user_id,session,variant,qs.to_string(),now()])?;
        (session, qs)
    };
    let result = json!({"session_id":session,"question_bank_version":catalog::VERSION,"questions":questions,"already_submitted":submitted});
    idem_save(&tx, &auth, &scope, &key, &fingerprint, &result)?;
    tx.commit()?;
    Ok(Json(result))
}
pub async fn respond(
    State(state): State<AppState>,
    auth: Auth,
    Path(token): Path<String>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<ResponseInput>,
) -> ApiResult<Json<Value>> {
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let invite = load(&tx, &token)?;
    valid(&invite)?;
    if invite.owner == auth.user_id {
        return Err(ApiError::forbidden("不能回应自己的邀请"));
    }
    let scope = format!("invites.responses:{token}");
    let (key, fingerprint, prior) =
        idem_read(&tx, &auth, &headers, &scope, &serde_json::to_value(&body)?)?;
    if let Some(v) = prior {
        return Ok(Json(v));
    }
    let assigned:Option<String>=tx.query_row("SELECT questions_json FROM friend_assignments WHERE invite_token=?1 AND respondent_id=?2 AND session_id=?3",params![token,auth.user_id,body.session_id],|r|r.get(0)).optional()?;
    let questions: Vec<catalog::Question> =
        serde_json::from_str(&assigned.ok_or_else(ApiError::missing)?)?;
    self_profile::validate_answers(&body.answers, &questions)?;
    let existing: Option<String> = tx
        .query_row(
            "SELECT answers_json FROM friend_responses WHERE assessment_id=?1 AND respondent_id=?2",
            params![invite.assessment, auth.user_id],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(old) = existing {
        let old: Vec<Answer> = serde_json::from_str(&old)?;
        let as_map = |a: &Vec<Answer>| {
            a.iter()
                .map(|v| (v.question_id.clone(), v.choice.as_str()))
                .collect::<BTreeMap<_, _>>()
        };
        if as_map(&old) != as_map(&body.answers) {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "already_submitted",
                "这份反馈已经提交，不能修改".into(),
            ));
        }
    } else {
        if count(&tx, &invite.assessment)? >= 3 {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "cohort_full",
                "已收到三份反馈".into(),
            ));
        }
        tx.execute(
            "INSERT INTO friend_responses VALUES(?1,?2,?3,?4,?5,?6)",
            params![
                id(),
                token,
                invite.assessment,
                auth.user_id,
                serde_json::to_string(&body.answers)?,
                now()
            ],
        )?;
        event(&tx, &auth.user_id, "friend_completed")?;
    }
    let result = json!({"submitted":true,"completed_count":count(&tx,&invite.assessment)?});
    idem_save(&tx, &auth, &scope, &key, &fingerprint, &result)?;
    tx.commit()?;
    Ok(Json(result))
}
pub fn mirror_json(db: &Connection, user: &str, requested: Option<&str>) -> ApiResult<Value> {
    let assessment = match requested {
        Some(id) => Some(id.to_owned()),
        None => self_profile::latest_id(db, user)?,
    };
    let Some(id) = assessment else {
        return Ok(
            json!({"self_assessment_id":null,"state":"empty","completed_count":0,"required_count":3,"respondent_basis":"distinct_sessions","identity_notice":"不同浏览器身份不等于已验证的不同真人","target_dimensions":[],"comparisons":[],"insights":[]}),
        );
    };
    let baseline = self_profile::assessment_json(db, &id, user)?;
    let n = count(db, &id)?;
    let mut stmt=db.prepare("SELECT r.answers_json,a.questions_json FROM friend_responses r JOIN friend_assignments a ON a.invite_token=r.invite_token AND a.respondent_id=r.respondent_id WHERE r.assessment_id=?1")?;
    let answers = stmt
        .query_map([&id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut totals: BTreeMap<String, (i64, i64)> = BTreeMap::new();
    for (raw, snapshot) in answers {
        let questions: Vec<catalog::Question> = serde_json::from_str(&snapshot)?;
        for a in serde_json::from_str::<Vec<Answer>>(&raw)? {
            let q = questions
                .iter()
                .find(|q| q.id == a.question_id)
                .ok_or_else(|| ApiError::bad("题库不存在"))?;
            if q.version != baseline["version"] {
                return Err(ApiError::conflict("反馈与自我观察的题库版本不兼容"));
            }
            let entry = totals.entry(q.dimension.clone().unwrap()).or_insert((0, 0));
            if a.choice.score() * q.direction_a == 1 {
                entry.0 += 1
            } else {
                entry.1 += 1
            }
        }
    }
    let mut comparisons = vec![];
    let mut insights = vec![];
    for dimension in baseline["target_dimensions"].as_array().unwrap() {
        let d = dimension.as_str().unwrap();
        let own = baseline["dimensions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|v| v["dimension"] == d)
            .unwrap();
        let score = own["score"].as_i64().unwrap();
        let (a, b) = totals.get(d).copied().unwrap_or((0, 0));
        let (la, lb) = catalog::dimension_labels(d);
        let consensus = if n < 3 {
            "insufficient"
        } else if a == 3 || b == 3 {
            "strong"
        } else {
            "moderate"
        };
        let relation = if n < 3 {
            "insufficient"
        } else if score == 0 {
            "contextual"
        } else if (a > b && score == 1) || (b > a && score == -1) {
            "aligned"
        } else {
            "gap"
        };
        let label = if a > b {
            Some(la)
        } else if b > a {
            Some(lb)
        } else {
            None
        };
        if relation == "gap" {
            insights.push(format!(
                "在「{}」这件事上，你与这三位参与者的多数看法有所不同。",
                own["label"].as_str().unwrap()
            ))
        } else if relation == "aligned" {
            insights.push(format!(
                "在「{}」这件事上，你与这三位参与者的多数看法一致。",
                own["label"].as_str().unwrap()
            ))
        }
        comparisons.push(json!({"dimension":d,"self_score":score,"self_label":own["label"],"a_count":a,"b_count":b,"sample_size":a+b,"friend_label":label,"consensus":consensus,"relation":relation}));
    }
    if n == 1 {
        insights.push("这是一位参与者的观察，还不能代表朋友们的共识。".into())
    }
    if n == 2 {
        insights.push("已经有两份独立身份的观察，再等一位再看是否形成共识。".into())
    }
    Ok(
        json!({"self_assessment_id":id,"state":if n==0{"empty"}else if n==1{"first"}else if n==2{"partial"}else{"full"},"completed_count":n,"required_count":3,"respondent_basis":"distinct_sessions","identity_notice":"不同浏览器或账户身份不等于已验证的不同真人","target_dimensions":baseline["target_dimensions"],"comparisons":comparisons,"insights":insights}),
    )
}
pub async fn mirror(
    State(state): State<AppState>,
    auth: Auth,
    Query(query): Query<MirrorQuery>,
) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    Ok(Json(mirror_json(
        &db,
        &auth.user_id,
        query.self_assessment_id.as_deref(),
    )?))
}
pub async fn revoke(
    State(state): State<AppState>,
    auth: Auth,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> ApiResult<StatusCode> {
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let invite = load(&tx, &token)?;
    if invite.owner != auth.user_id {
        return Err(ApiError::missing());
    }
    let scope = format!("invites.delete:{token}");
    let (key, fingerprint, _) = idem_read(&tx, &auth, &headers, &scope, &Value::Null)?;
    tx.execute(
        "UPDATE friend_invites SET revoked=1 WHERE token=?1",
        [&token],
    )?;
    tx.execute("DELETE FROM friend_assignments WHERE invite_token=?1 AND respondent_id NOT IN(SELECT respondent_id FROM friend_responses WHERE invite_token=?1)",[&token])?;
    tx.execute(
        "INSERT OR IGNORE INTO idempotency_keys(user_id,scope,key,fingerprint,response_json,created_at) VALUES(?1,?2,?3,?4,'null',?5)",
        params![auth.user_id, scope, key, fingerprint, now()],
    )?;
    tx.commit()?;
    Ok(StatusCode::NO_CONTENT)
}
