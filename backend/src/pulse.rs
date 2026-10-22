use crate::{catalog, core::*, self_profile};
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PulseInput {
    choice: Choice,
}
#[derive(Deserialize)]
pub struct JournalQuery {
    limit: Option<usize>,
    cursor: Option<String>,
    from: Option<String>,
    to: Option<String>,
    choice: Option<String>,
}
pub fn pulse_id(day: &str, question: &str) -> String {
    format!("{day}_{question}")
}
pub fn crowd(
    db: &Connection,
    day: &str,
    question: &str,
    version: &str,
    region: &str,
) -> ApiResult<Value> {
    let(a,b):(i64,i64)=db.query_row("SELECT COALESCE(sum(choice='A'),0),COALESCE(sum(choice='B'),0) FROM pulse_answers WHERE day=?1 AND question_id=?2 AND version=?3 AND region=?4",params![day,question,version,region],|r|Ok((r.get(0)?,r.get(1)?)))?;
    let n = a + b;
    let percent = if n >= 50 {
        Some(((a as f64 / n as f64) * 100.0).round() as i64)
    } else {
        None
    };
    Ok(
        json!({"sample_size":n,"mode":if n==0{"insufficient"}else if n<50{"qualitative"}else{"percentage"},"majority":if n==0{Value::Null}else{json!(if a>b{"A"}else if b>a{"B"}else{"tie"})},"a_percent":percent,"b_percent":percent.map(|v|100-v)}),
    )
}
pub fn today_json(db: &Connection, state: &AppState, user: &str) -> ApiResult<Value> {
    let day = state.today().to_string();
    let mut question = catalog::pulse_for_date(state.today());
    let answer: Option<(String, String, String, String, String)> = db
        .query_row(
            "SELECT id,choice,created_at,question_json,region FROM pulse_answers WHERE user_id=?1 AND day=?2",
            params![user, day],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let saved_count: i64 = db.query_row(
        "SELECT count(*) FROM pulse_answers WHERE user_id=?1",
        [user],
        |r| r.get(0),
    )?;
    let answered = answer.is_some();
    if let Some((_, _, _, snapshot, _)) = &answer {
        question = serde_json::from_str(snapshot)?;
    }
    let region = answer.as_ref().map(|a| a.4.as_str()).unwrap_or("CN");
    Ok(
        json!({"id":pulse_id(&day,&question.id),"date":day,"region":region,"timezone":"Asia/Shanghai","topic":question.topic,"question":question,"answer":answer.as_ref().map(|(id,choice,created,_,_)|json!({"id":id,"question_id":question.id,"choice":choice,"answered_at":created})),"crowd":if answered{crowd(db,&day,&question.id,&question.version,region)?}else{Value::Null},"saved_count":saved_count}),
    )
}
pub async fn today(State(state): State<AppState>, auth: Auth) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    Ok(Json(today_json(&db, &state, &auth.user_id)?))
}
pub async fn answer(
    State(state): State<AppState>,
    auth: Auth,
    Path(pulse): Path<String>,
    headers: HeaderMap,
    ApiJson(body): ApiJson<PulseInput>,
) -> ApiResult<Json<Value>> {
    let day = state.today().to_string();
    let question = catalog::pulse_for_date(state.today());
    if pulse != pulse_id(&day, &question.id) {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "pulse_expired",
            "已经进入新的一天，请回答今天的问题".into(),
        ));
    }
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let scope = format!("pulse.answer:{pulse}");
    let (key, fingerprint, prior) =
        idem_read(&tx, &auth, &headers, &scope, &serde_json::to_value(&body)?)?;
    if let Some(v) = prior {
        return Ok(Json(v));
    }
    let existing: Option<String> = tx
        .query_row(
            "SELECT choice FROM pulse_answers WHERE user_id=?1 AND day=?2",
            params![auth.user_id, day],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(choice) = existing {
        if choice != body.choice.as_str() {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "already_answered",
                "今天的选择已经保存，不能更改".into(),
            ));
        }
    } else {
        tx.execute("INSERT INTO pulse_answers(id,user_id,day,question_id,question_json,version,region,choice,created_at) VALUES(?1,?2,?3,?4,?5,?6,'CN',?7,?8)",params![id(),auth.user_id,day,question.id,serde_json::to_string(&question)?,catalog::VERSION,body.choice.as_str(),now()])?;
        event(&tx, &auth.user_id, "pulse_answered")?;
    }
    let result = today_json(&tx, &state, &auth.user_id)?;
    idem_save(&tx, &auth, &scope, &key, &fingerprint, &result)?;
    tx.commit()?;
    Ok(Json(result))
}
pub fn journal_entries(
    db: &Connection,
    user: &str,
    limit: usize,
    before: Option<&str>,
) -> ApiResult<Vec<Value>> {
    let mut stmt=db.prepare("SELECT id,day,question_json,choice,created_at FROM pulse_answers WHERE user_id=?1 AND (?2 IS NULL OR day<?2) ORDER BY day DESC LIMIT ?3")?;
    let rows = stmt
        .query_map(params![user, before, limit as i64], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(|(id,day,q,choice,created)|{let question:catalog::Question=serde_json::from_str(&q)?;Ok(json!({"answer_id":id,"pulse_id":pulse_id(&day,&question.id),"date":day,"question":question,"choice":choice,"answered_at":created,"share_eligible":true}))}).collect()
}
pub async fn journal(
    State(state): State<AppState>,
    auth: Auth,
    Query(query): Query<JournalQuery>,
) -> ApiResult<Json<Value>> {
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    for date in [&query.cursor, &query.from, &query.to]
        .into_iter()
        .flatten()
    {
        let parsed = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|_| ApiError::bad("日期必须为 YYYY-MM-DD"))?;
        if parsed.to_string() != *date {
            return Err(ApiError::bad("日期必须为 YYYY-MM-DD"));
        }
    }
    if query
        .from
        .as_ref()
        .zip(query.to.as_ref())
        .is_some_and(|(from, to)| from > to)
    {
        return Err(ApiError::bad("开始日期不能晚于结束日期"));
    }
    let choice = query.choice.as_deref();
    if choice.is_some_and(|c| c != "A" && c != "B") {
        return Err(ApiError::bad("选项必须为 A 或 B"));
    }
    let db = state.db.lock().expect("db");
    let mut stmt = db.prepare("SELECT id,day,question_json,choice,created_at FROM pulse_answers WHERE user_id=?1 AND (?2 IS NULL OR day<?2) AND (?3 IS NULL OR day>=?3) AND (?4 IS NULL OR day<=?4) AND (?5 IS NULL OR choice=?5) ORDER BY day DESC LIMIT ?6")?;
    let rows = stmt
        .query_map(
            params![
                auth.user_id,
                query.cursor,
                query.from,
                query.to,
                choice,
                (limit + 1) as i64
            ],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let mut entries = rows.into_iter().map(|(id,day,q,choice,created)| {
        let question:catalog::Question=serde_json::from_str(&q)?;
        Ok(json!({"answer_id":id,"pulse_id":pulse_id(&day,&question.id),"date":day,"question":question,"choice":choice,"answered_at":created,"share_eligible":true}))
    }).collect::<ApiResult<Vec<_>>>()?;
    let more = entries.len() > limit;
    entries.truncate(limit);
    let cursor = if more {
        entries.last().map(|e| e["date"].clone())
    } else {
        None
    };
    let total: i64 = db.query_row("SELECT count(*) FROM pulse_answers WHERE user_id=?1 AND (?2 IS NULL OR day>=?2) AND (?3 IS NULL OR day<=?3) AND (?4 IS NULL OR choice=?4)",params![auth.user_id,query.from,query.to,choice],|r|r.get(0))?;
    Ok(Json(
        json!({"entries":entries,"next_cursor":cursor,"total":total}),
    ))
}
pub async fn solo(State(state): State<AppState>, auth: Auth) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    let entries = journal_entries(&db, &auth.user_id, 7, None)?;
    let total: i64 = db.query_row(
        "SELECT count(*) FROM pulse_answers WHERE user_id=?1",
        [&auth.user_id],
        |r| r.get(0),
    )?;
    let eligible = entries.len() >= 7;
    let mut most_different: Option<Value> = None;
    let mut most_aligned: Option<Value> = None;
    let mut comparison: Option<Value> = None;
    if eligible {
        let mut observations: BTreeMap<String, Vec<i32>> = BTreeMap::new();
        for entry in &entries {
            let day = entry["date"].as_str().unwrap();
            let q: catalog::Question = serde_json::from_value(entry["question"].clone())?;
            let stats = crowd(&db, day, &q.id, &q.version, &q.region)?;
            if let Some(a) = stats["a_percent"].as_i64() {
                let same = if entry["choice"] == "A" { a } else { 100 - a };
                let card = json!({"entry":entry,"same_choice_percent":same,"sample_size":stats["sample_size"]});
                if most_different
                    .as_ref()
                    .is_none_or(|v| same < v["same_choice_percent"].as_i64().unwrap())
                {
                    most_different = Some(card.clone())
                }
                if most_aligned
                    .as_ref()
                    .is_none_or(|v| same > v["same_choice_percent"].as_i64().unwrap())
                {
                    most_aligned = Some(card)
                }
            }
            if let Some(d) = q.dimension_hint {
                observations
                    .entry(d)
                    .or_default()
                    .push(if entry["choice"] == "A" {
                        q.direction_a
                    } else {
                        -q.direction_a
                    });
            }
        }
        // Use a baseline that existed before this observed date window, never a later self retest.
        let start = entries.last().unwrap()["date"].as_str().unwrap();
        let start_day = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
            .map_err(|_| ApiError::bad("日期无效"))?;
        let boundary = (start_day.and_hms_opt(0, 0, 0).unwrap() - chrono::Duration::hours(8))
            .and_utc()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let baseline:Option<String>=db.query_row("SELECT id FROM assessments WHERE user_id=?1 AND created_at<?2 ORDER BY created_at ASC,rowid ASC LIMIT 1",params![auth.user_id,boundary],|r|r.get(0)).optional()?;
        if let Some(id) = baseline {
            let baseline = self_profile::assessment_json(&db, &id, &auth.user_id)?;
            for d in baseline["dimensions"].as_array().unwrap() {
                let score = d["score"].as_i64().unwrap() as i32;
                let name = d["dimension"].as_str().unwrap();
                if score == 0 {
                    continue;
                }
                if let Some(items) = observations.get(name) {
                    if items.len() >= 2 && items.iter().all(|v| *v == items[0]) {
                        let kind = if items[0] == score { "echo" } else { "gap" };
                        comparison = Some(
                            json!({"dimension":name,"kind":kind,"evidence_count":items.len(),"text":if kind=="echo"{format!("{}次相关答题的选择方向与首次自我评估结果一致。",items.len())}else{format!("{}次相关答题的选择方向与首次自我评估结果不同；不同题目的情境也可能影响选择。",items.len())}}),
                        );
                        break;
                    }
                }
            }
        }
    }
    Ok(Json(
        json!({"answered_days":total,"required_days":7,"eligible":eligible,"window_start":entries.last().map(|v|v["date"].clone()),"window_end":entries.first().map(|v|v["date"].clone()),"most_different":most_different,"most_aligned":most_aligned,"self_comparison":comparison,"notice":if !eligible{"完成 7 个不同日期的答题后，可查看答题汇总。"}else if most_aligned.is_none(){"真实群体样本尚未达到 50，暂不展示精确群体百分比。"}else{"这是这些场景里的暂时观察，不是人格结论。"}}),
    ))
}

/// Resolve a specific owned historical answer without an arbitrary recent-history cap.
pub async fn journal_entry(
    State(state): State<AppState>,
    auth: Auth,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    let row:Option<(String,String,String,String)>=db.query_row("SELECT day,question_json,choice,created_at FROM pulse_answers WHERE id=?1 AND user_id=?2",params![id,auth.user_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
    let (day, q, choice, created) = row.ok_or_else(ApiError::missing)?;
    let question: catalog::Question = serde_json::from_str(&q)?;
    Ok(Json(
        json!({"answer_id":id,"pulse_id":pulse_id(&day,&question.id),"date":day,"question":question,"choice":choice,"answered_at":created,"share_eligible":true}),
    ))
}
