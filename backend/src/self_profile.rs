use crate::{catalog, core::*};
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssessmentInput {
    version: String,
    answers: Vec<Answer>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FeedbackInput {
    rating: String,
}
pub fn validate_answers(answers: &[Answer], expected: &[catalog::Question]) -> ApiResult<()> {
    if answers.len() != expected.len() {
        return Err(ApiError::bad(format!("请完整回答 {} 道题", expected.len())));
    }
    let mut seen = HashSet::new();
    for a in answers {
        if !seen.insert(&a.question_id) || !expected.iter().any(|q| q.id == a.question_id) {
            return Err(ApiError::bad("包含重复或未知问题"));
        }
    }
    Ok(())
}
pub fn scores(answers: &[Answer]) -> BTreeMap<String, i32> {
    let mut result = BTreeMap::new();
    for a in answers {
        let d = a
            .question_id
            .split('-')
            .nth(1)
            .expect("validated id")
            .to_string();
        *result.entry(d).or_insert(0) += a.choice.score();
    }
    for score in result.values_mut() {
        *score /= 2;
    }
    result
}
pub fn target_dimensions(scores: &BTreeMap<String, i32>) -> Vec<String> {
    let priority = ["D1", "D2", "D4", "D3"];
    let mut all = priority
        .iter()
        .filter(|d| scores[**d] != 0)
        .chain(priority.iter().filter(|d| scores[**d] == 0))
        .map(|d| d.to_string())
        .collect::<Vec<_>>();
    all.truncate(3);
    all
}
pub fn assessment_json(db: &Connection, id: &str, user: &str) -> ApiResult<Value> {
    let row:Option<(String,String,String,String,String)>=db.query_row("SELECT version,answers_json,scores_json,target_dimensions_json,created_at FROM assessments WHERE id=?1 AND user_id=?2",params![id,user],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional()?;
    let (version, answers, scores, targets, created) = row.ok_or_else(ApiError::missing)?;
    let scores: BTreeMap<String, i32> = serde_json::from_str(&scores)?;
    let answers: Vec<Answer> = serde_json::from_str(&answers)?;
    let targets: Vec<String> = serde_json::from_str(&targets)?;
    let dimensions=scores.iter().map(|(dimension,score)|{let(a,b)=catalog::dimension_labels(dimension);json!({"dimension":dimension,"score":score,"label":if *score==1{a}else if *score==-1{b}else{"看场景"},"state":if *score==0{"contextual"}else{"stable"}})}).collect::<Vec<_>>();
    // Keep the existing two stable + at most one contextual selection policy.
    // Attach dimension identities instead of asking clients to parse display prose.
    let selected = scores
        .iter()
        .filter(|(_, score)| **score != 0)
        .take(2)
        .chain(scores.iter().filter(|(_, score)| **score == 0).take(1));
    let observation_details = selected.map(|(dimension, score)| {
        let (a, b) = catalog::dimension_labels(dimension);
        let title = match dimension.as_str() {
            "D1" => "做事方式", "D2" => "表达方式",
            "D3" => "体验偏好", "D4" => "情绪表达", _ => "其他维度",
        };
        let label = if *score == 1 { a } else if *score == -1 { b } else { "看场景" };
        let value = if *score == 0 { "视情境而定".to_string() } else { format!("偏向{label}") };
        let description = if *score == 0 {
            "不同情境的选择不同，暂不归为单一倾向。".to_string()
        } else {
            "".to_string()
        };
        json!({"dimension":dimension,"title":title,"value":value,"state":if *score == 0 {"contextual"} else {"stable"},"description":description})
    }).collect::<Vec<_>>();
    // Legacy field remains available, now explicitly names each independent dimension.
    let observations = observation_details
        .iter()
        .map(|item| {
            format!(
                "{}：{}。",
                item["title"].as_str().unwrap(),
                item["value"].as_str().unwrap()
            )
        })
        .collect::<Vec<_>>();
    let summary = if observations.is_empty() {
        "暂时没有可展示的选择倾向。".into()
    } else {
        observations.join("")
    };
    Ok(
        json!({"id":id,"version":version,"created_at":created,"answers":answers.iter().map(|a|json!({"id":format!("{}:{}",id,a.question_id),"question_id":a.question_id,"choice":a.choice,"answered_at":created})).collect::<Vec<_>>(),"dimensions":dimensions,"observations":observations,"observation_details":observation_details,"summary":summary,"target_dimensions":targets}),
    )
}
pub fn latest_id(db: &Connection, user: &str) -> ApiResult<Option<String>> {
    Ok(db.query_row("SELECT id FROM assessments WHERE user_id=?1 ORDER BY created_at DESC,rowid DESC LIMIT 1",[user],|r|r.get(0)).optional()?)
}
pub async fn questions() -> Json<Value> {
    Json(json!({"version":catalog::VERSION,"questions":catalog::self_questions(),"locale":"zh-CN"}))
}
pub async fn create(
    State(state): State<AppState>,
    auth: Auth,
    headers: HeaderMap,
    ApiJson(body): ApiJson<AssessmentInput>,
) -> ApiResult<Json<Value>> {
    if body.version != catalog::VERSION {
        return Err(ApiError::bad("题库版本已更新，请重新开始"));
    }
    validate_answers(&body.answers, &catalog::self_questions())?;
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let (key, fingerprint, prior) = idem_read(
        &tx,
        &auth,
        &headers,
        "self.create",
        &serde_json::to_value(&body)?,
    )?;
    if let Some(prior) = prior {
        return Ok(Json(prior));
    }
    let score = scores(&body.answers);
    let targets = target_dimensions(&score);
    let id = id();
    tx.execute(
        "INSERT INTO assessments VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            id,
            auth.user_id,
            catalog::VERSION,
            serde_json::to_string(&body.answers)?,
            serde_json::to_string(&score)?,
            serde_json::to_string(&targets)?,
            now()
        ],
    )?;
    let result = assessment_json(&tx, &id, &auth.user_id)?;
    idem_save(&tx, &auth, "self.create", &key, &fingerprint, &result)?;
    event(&tx, &auth.user_id, "self_completed")?;
    tx.commit()?;
    Ok(Json(result))
}
pub async fn latest(State(state): State<AppState>, auth: Auth) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    Ok(Json(match latest_id(&db, &auth.user_id)? {
        Some(id) => assessment_json(&db, &id, &auth.user_id)?,
        None => Value::Null,
    }))
}
pub async fn feedback(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<FeedbackInput>,
) -> ApiResult<Json<Value>> {
    if !["very_like", "somewhat_like", "not_like"].contains(&body.rating.as_str()) {
        return Err(ApiError::bad("请选择有效反馈"));
    }
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    assessment_json(&tx, &id, &auth.user_id)?;
    let scope = format!("self.feedback:{id}");
    let (key, fingerprint, prior) =
        idem_read(&tx, &auth, &headers, &scope, &serde_json::to_value(&body)?)?;
    if let Some(value) = prior {
        return Ok(Json(value));
    }
    tx.execute("INSERT INTO self_feedback VALUES(?1,?2,?3,?4)ON CONFLICT(assessment_id,user_id) DO UPDATE SET rating=excluded.rating,created_at=excluded.created_at",params![id,auth.user_id,body.rating,now()])?;
    let result = json!({"saved":true});
    idem_save(&tx, &auth, &scope, &key, &fingerprint, &result)?;
    tx.commit()?;
    Ok(Json(result))
}

#[derive(Deserialize)]
pub struct HistoryQuery {
    limit: Option<usize>,
    cursor: Option<String>,
}
/// Opaque assessment IDs anchor a private, stable (timestamp,rowid) cursor.
pub async fn history(
    State(state): State<AppState>,
    auth: Auth,
    Query(query): Query<HistoryQuery>,
) -> ApiResult<Json<Value>> {
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let db = state.db.lock().expect("db");
    let anchor: Option<(String, i64)> = if let Some(cursor) = query.cursor {
        Some(
            db.query_row(
                "SELECT created_at,rowid FROM assessments WHERE id=?1 AND user_id=?2",
                params![cursor, auth.user_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(ApiError::missing)?,
        )
    } else {
        None
    };
    let mut stmt = db.prepare("SELECT id FROM assessments WHERE user_id=?1 AND (?2 IS NULL OR created_at<?2 OR (created_at=?2 AND rowid<?3)) ORDER BY created_at DESC,rowid DESC LIMIT ?4")?;
    let ids = stmt
        .query_map(
            params![
                auth.user_id,
                anchor.as_ref().map(|a| a.0.as_str()),
                anchor.as_ref().map(|a| a.1),
                (limit + 1) as i64
            ],
            |r| r.get::<_, String>(0),
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let more = ids.len() > limit;
    let assessments = ids
        .into_iter()
        .take(limit)
        .map(|id| assessment_json(&db, &id, &auth.user_id))
        .collect::<ApiResult<Vec<_>>>()?;
    let cursor = if more {
        assessments.last().map(|a| a["id"].clone())
    } else {
        None
    };
    let total: i64 = db.query_row(
        "SELECT count(*) FROM assessments WHERE user_id=?1",
        [&auth.user_id],
        |r| r.get(0),
    )?;
    Ok(Json(
        json!({"assessments":assessments,"next_cursor":cursor,"total":total}),
    ))
}
