use crate::{core::*, friends, self_profile};
use axum::{extract::State, Json};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
pub async fn get(State(state): State<AppState>, auth: Auth) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    let user = user_json(&db, &auth.user_id)?;
    let assessment = self_profile::latest_id(&db, &auth.user_id)?;
    let mirror = friends::mirror_json(&db, &auth.user_id, None)?;
    let (saved_count, answered_today): (i64, bool) = db.query_row(
        "SELECT count(*),COALESCE(max(day=?2),0) FROM pulse_answers WHERE user_id=?1",
        params![auth.user_id, state.today().to_string()],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let latest: Option<String> = db
        .query_row(
            "SELECT id FROM pulse_answers WHERE user_id=?1 ORDER BY day DESC LIMIT 1",
            [&auth.user_id],
            |r| r.get(0),
        )
        .optional()?;
    let created: i64 = db.query_row(
        "SELECT count(*) FROM challenges WHERE owner_id=?1",
        [&auth.user_id],
        |r| r.get(0),
    )?;
    let received: i64 = db.query_row(
        "SELECT count(*) FROM guesses WHERE guesser_id=?1",
        [&auth.user_id],
        |r| r.get(0),
    )?;
    let expires: i64 = db.query_row(
        "SELECT expires_at FROM sessions WHERE token_hash=?1",
        [&auth.token_hash],
        |r| r.get(0),
    )?;
    Ok(Json(
        json!({"user":user,"self":{"completed":assessment.is_some(),"assessment_id":assessment},"daily":{"saved_count":saved_count,"answered_today":answered_today,"latest_answer_id":latest},"friends":{"completed_count":mirror["completed_count"],"state":mirror["state"]},"guesses":{"created_count":created,"received_count":received},"guest_expires_at":if user["kind"]=="guest"{json!(chrono::DateTime::from_timestamp(expires,0).unwrap().to_rfc3339())}else{Value::Null},"capabilities":{"can_invite":true,"can_guess":true,"can_register":user["kind"]=="guest"}}),
    ))
}
