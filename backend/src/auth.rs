use crate::core::*;
use argon2::{
    password_hash::{PasswordHash, PasswordVerifier},
    Argon2,
};
use axum::{
    extract::State,
    http::{header::SET_COOKIE, HeaderMap, StatusCode},
    Extension, Json,
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuestInput {
    locale: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegisterInput {
    username: String,
    password: String,
    display_name: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProfileInput {
    display_name: Option<String>,
    locale: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeleteInput {
    confirmation: String,
    password: Option<String>,
}
fn locale(value: Option<String>) -> ApiResult<String> {
    let value = value.unwrap_or_else(|| "zh-CN".into());
    if value != "zh-CN" && value != "en" {
        return Err(ApiError::bad("暂不支持此语言"));
    }
    Ok(value)
}
fn display(value: String) -> ApiResult<String> {
    let value = value.trim().to_owned();
    if value.is_empty() || value.chars().count() > 40 || value.chars().any(|c| c.is_control()) {
        return Err(ApiError::bad("昵称需要 1–40 个字符"));
    }
    Ok(value)
}
fn username(value: String) -> ApiResult<String> {
    let value = value.trim().to_ascii_lowercase();
    if !(3..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
    {
        return Err(ApiError(
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_username",
            "用户名需 3–32 个小写字母、数字或下划线".into(),
        ));
    }
    Ok(value)
}
pub async fn session(
    State(state): State<AppState>,
    auth: Option<Extension<Auth>>,
) -> ApiResult<Json<Value>> {
    let Some(Extension(auth)) = auth else {
        return Ok(Json(json!({"user":null,"csrf_token":null})));
    };
    let db = state.db.lock().expect("db");
    require_live_session(&db, &auth)?;
    Ok(Json(
        json!({"user":user_json(&db,&auth.user_id)?,"csrf_token":auth.csrf_token}),
    ))
}
pub async fn guest(
    State(state): State<AppState>,
    auth: Option<Extension<Auth>>,
    ApiJson(body): ApiJson<GuestInput>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let loc = locale(body.locale)?;
    let mut db = state.db.lock().expect("db");
    if let Some(Extension(auth)) = auth {
        require_live_session(&db, &auth)?;
        return Ok((
            HeaderMap::new(),
            Json(json!({"user":user_json(&db,&auth.user_id)?,"csrf_token":auth.csrf_token})),
        ));
    }
    state.limit("guest_creation".into(), 120)?;
    let tx = db.transaction()?;
    let user = id();
    tx.execute(
        "INSERT INTO users(id,locale,created_at)VALUES(?1,?2,?3)",
        params![user, loc, now()],
    )?;
    event(&tx, &user, "guest_created")?;
    let (body, cookie) = issue_session(&tx, &state, &user)?;
    tx.commit()?;
    let mut headers = HeaderMap::new();
    headers.insert(SET_COOKIE, cookie);
    Ok((headers, Json(body)))
}
pub async fn register(
    State(state): State<AppState>,
    auth: Auth,
    ApiJson(body): ApiJson<RegisterInput>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    state.limit(format!("register:{}", auth.user_id), 5)?;
    let username = username(body.username)?;
    let display = display(body.display_name.unwrap_or_else(|| username.clone()))?;
    crate::auth_security::validate_password(&body.password)?;
    let password_hash = crate::auth_security::password_hash(&state, body.password).await?;
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    require_live_session(&tx, &auth)?;
    let kind: String =
        tx.query_row("SELECT kind FROM users WHERE id=?1", [&auth.user_id], |r| {
            r.get(0)
        })?;
    if kind != "guest" {
        return Err(ApiError::conflict("当前已是正式账户"));
    }
    let taken: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM users WHERE username=?1)",
        [&username],
        |r| r.get(0),
    )?;
    if taken {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "username_taken",
            "这个用户名已被使用".into(),
        ));
    }
    tx.execute("UPDATE users SET kind='registered',username=?1,password_hash=?2,display_name=?3 WHERE id=?4",params![username,password_hash,display,auth.user_id])?;
    tx.execute("DELETE FROM sessions WHERE user_id=?1", [&auth.user_id])?;
    event(&tx, &auth.user_id, "signup_completed")?;
    let (body, cookie) = issue_session(&tx, &state, &auth.user_id)?;
    tx.commit()?;
    let mut headers = HeaderMap::new();
    headers.insert(SET_COOKIE, cookie);
    Ok((headers, Json(body)))
}
// Shared password verification deliberately returns no account details before success.
pub(crate) async fn verify_credentials(
    state: &AppState,
    body: LoginInput,
) -> ApiResult<(String, String)> {
    state.limit("auth_global".into(), 30)?;
    let username = body.username.trim().to_ascii_lowercase();
    state.limit(format!("login:{}", hash(&username)), 8)?;
    if body.password.len() > 512 || username.len() > 64 {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "invalid_credentials",
            "用户名或密码不正确".into(),
        ));
    }
    let found: Option<(String, String)> = {
        let db = state.db.lock().expect("db");
        db.query_row(
            "SELECT id,password_hash FROM users WHERE username=?1 AND kind='registered'",
            [username],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?
    };
    let permit = state
        .password_jobs
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| {
            ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "unavailable",
                "认证暂不可用".into(),
            )
        })?;
    let candidate = found.clone();
    let verified = tokio::task::spawn_blocking(move || {
        // Keep the permit until CPU work ends even if the request is cancelled.
        let _permit = permit;
        let dummy = "$argon2id$v=19$m=19456,t=2,p=1$bm9seWFkdW1teXNhbHQxMg$LR5buip4RZHkeRDaCt30wI2ijJZpqZvwSLHUqkm4c08";
        let stored = candidate.as_ref().map(|x| x.1.as_str()).unwrap_or(dummy);
        PasswordHash::new(stored).is_ok_and(|parsed| {
            Argon2::default()
                .verify_password(body.password.as_bytes(), &parsed)
                .is_ok()
        })
    })
    .await
    .unwrap_or(false);
    if !verified || found.is_none() {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "invalid_credentials",
            "用户名或密码不正确".into(),
        ));
    }
    Ok(found.expect("verified user"))
}

pub(crate) fn require_live_session(db: &rusqlite::Connection, auth: &Auth) -> ApiResult<()> {
    let live: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE token_hash=?1 AND user_id=?2 AND csrf_token=?3 AND expires_at>?4)",
        params![auth.token_hash,auth.user_id,auth.csrf_token,chrono::Utc::now().timestamp()],
        |r| r.get(0),
    )?;
    if !live {
        return Err(ApiError::unauthorized());
    }
    Ok(())
}

pub async fn login(
    State(state): State<AppState>,
    current: Option<Extension<Auth>>,
    ApiJson(body): ApiJson<LoginInput>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    let (user, verified_hash) = verify_credentials(&state, body).await?;
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let destination_valid: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND kind='registered' AND password_hash=?2)",
        params![user, verified_hash],
        |r| r.get(0),
    )?;
    if !destination_valid {
        return Err(ApiError::unauthorized());
    }

    if let Some(Extension(auth)) = current {
        require_live_session(&tx, &auth)?;
        if auth.user_id != user {
            let kind: String =
                tx.query_row("SELECT kind FROM users WHERE id=?1", [&auth.user_id], |r| {
                    r.get(0)
                })?;
            if kind == "guest" {
                let records:i64=tx.query_row("SELECT (SELECT count(*) FROM assessments WHERE user_id=?1)+(SELECT count(*) FROM pulse_answers WHERE user_id=?1)+(SELECT count(*) FROM friend_responses WHERE respondent_id=?1)+(SELECT count(*) FROM guesses WHERE guesser_id=?1)+(SELECT count(*) FROM challenges WHERE owner_id=?1)+(SELECT count(*) FROM friend_assignments WHERE respondent_id=?1)",[&auth.user_id],|r|r.get(0))?;
                if records > 0 {
                    return Err(ApiError(StatusCode::CONFLICT,"guest_merge_required","此访客已有记录。请先查看合并预览并明确确认；存在冲突时两个空间都会保留，也可以保存为独立账户。".into()));
                }
            }
        }
        tx.execute(
            "DELETE FROM sessions WHERE token_hash=?1",
            [auth.token_hash],
        )?;
    }
    let (body, cookie) = issue_session(&tx, &state, &user)?;
    tx.commit()?;
    let mut headers = HeaderMap::new();
    headers.insert(SET_COOKIE, cookie);
    Ok((headers, Json(body)))
}
pub async fn logout(
    State(state): State<AppState>,
    auth: Auth,
) -> ApiResult<(StatusCode, HeaderMap)> {
    let db = state.db.lock().expect("db");
    db.execute(
        "DELETE FROM sessions WHERE token_hash=?1",
        [auth.token_hash],
    )?;
    Ok((
        StatusCode::NO_CONTENT,
        crate::auth_security::clear_cookie(&state),
    ))
}
pub async fn profile(
    State(state): State<AppState>,
    auth: Auth,
    ApiJson(body): ApiJson<ProfileInput>,
) -> ApiResult<Json<Value>> {
    let name = body.display_name.map(display).transpose()?;
    let loc = body.locale.map(|s| locale(Some(s))).transpose()?;
    let db = state.db.lock().expect("db");
    require_live_session(&db, &auth)?;
    db.execute("UPDATE users SET display_name=COALESCE(?1,display_name),locale=COALESCE(?2,locale) WHERE id=?3",params![name,loc,auth.user_id])?;
    Ok(Json(json!({"user":user_json(&db,&auth.user_id)?})))
}
pub async fn export(State(state): State<AppState>, auth: Auth) -> ApiResult<Json<Value>> {
    let db = state.db.lock().expect("db");
    require_live_session(&db, &auth)?;
    let mut records = serde_json::Map::new();
    for (table, column, fields) in [
        (
            "assessments",
            "user_id",
            "id,version,answers_json,scores_json,target_dimensions_json,created_at",
        ),
        (
            "pulse_answers",
            "user_id",
            "id,day,question_id,question_json,version,region,choice,created_at",
        ),
        (
            "friend_responses",
            "respondent_id",
            "id,answers_json,created_at",
        ),
        ("guesses", "guesser_id", "id,choice,correct,created_at"),
        (
            "challenges",
            "owner_id",
            "token,question_json,answer,source,created_at,expires_at,revoked",
        ),
        ("journal_notes", "user_id", "answer_id,note,updated_at"),
    ] {
        let mut stmt = db.prepare(&format!("SELECT {fields} FROM {table} WHERE {column}=?1"))?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let rows = stmt
            .query_map([&auth.user_id], |r| {
                let mut out = serde_json::Map::new();
                for (i, name) in names.iter().enumerate() {
                    let value = match r.get_ref(i)? {
                        rusqlite::types::ValueRef::Null => Value::Null,
                        rusqlite::types::ValueRef::Integer(n) => json!(n),
                        rusqlite::types::ValueRef::Real(n) => json!(n),
                        rusqlite::types::ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                        _ => Value::Null,
                    };
                    out.insert(name.clone(), value);
                }
                Ok(Value::Object(out))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        records.insert(table.into(), json!(rows));
    }
    Ok(Json(
        json!({"exported_at":now(),"user":user_json(&db,&auth.user_id)?,"records":records}),
    ))
}
pub async fn delete_account(
    State(state): State<AppState>,
    auth: Auth,
    ApiJson(body): ApiJson<DeleteInput>,
) -> ApiResult<(StatusCode, HeaderMap)> {
    if body.confirmation != "DELETE" {
        return Err(ApiError::bad("需要输入 DELETE 确认"));
    }
    let registered = {
        let db = state.db.lock().expect("db");
        require_live_session(&db, &auth)?;
        db.query_row(
            "SELECT kind='registered' FROM users WHERE id=?1",
            [&auth.user_id],
            |r| r.get::<_, bool>(0),
        )?
    };
    let verified = if registered {
        let password = body.password.ok_or_else(|| {
            ApiError(
                StatusCode::UNAUTHORIZED,
                "reauth_required",
                "删除账户需要验证当前密码".into(),
            )
        })?;
        Some(crate::auth_security::reauthenticate(&state, &auth, password).await?)
    } else {
        None
    };
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    require_live_session(&tx, &auth)?;
    if let Some(verified) = verified {
        crate::auth_security::require_verified_password(&tx, &auth, &verified)?;
    } else {
        let still_guest: bool = tx.query_row(
            "SELECT kind='guest' FROM users WHERE id=?1",
            [&auth.user_id],
            |r| r.get(0),
        )?;
        if !still_guest {
            return Err(ApiError::unauthorized());
        }
    }
    // Purge cached disclosures across identities before removing the source rounds.
    tx.execute("DELETE FROM idempotency_keys WHERE scope IN (SELECT 'guesses.answer:'||token FROM challenges WHERE owner_id=?1 UNION SELECT 'guesses.reverse:'||token FROM challenges WHERE owner_id=?1 UNION SELECT 'guesses.delete:'||token FROM challenges WHERE owner_id=?1 UNION SELECT 'invites.start:'||token FROM friend_invites WHERE user_id=?1 UNION SELECT 'invites.responses:'||token FROM friend_invites WHERE user_id=?1 UNION SELECT 'invites.delete:'||token FROM friend_invites WHERE user_id=?1)",[&auth.user_id])?;
    tx.execute(
        "DELETE FROM journal_notes WHERE user_id=?1",
        [&auth.user_id],
    )?;
    tx.execute("DELETE FROM guesses WHERE guesser_id=?1 OR challenge_token IN(SELECT token FROM challenges WHERE owner_id=?1)",[&auth.user_id])?;
    tx.execute("UPDATE challenges SET parent_token=NULL WHERE parent_token IN(SELECT token FROM challenges WHERE owner_id=?1)",[&auth.user_id])?;
    tx.execute(
        "UPDATE challenges SET target_user_id=NULL,revoked=1 WHERE target_user_id=?1",
        [&auth.user_id],
    )?;
    tx.execute("DELETE FROM challenges WHERE owner_id=?1", [&auth.user_id])?;
    tx.execute("DELETE FROM friend_responses WHERE respondent_id=?1 OR assessment_id IN(SELECT id FROM assessments WHERE user_id=?1)",[&auth.user_id])?;
    tx.execute("DELETE FROM friend_assignments WHERE respondent_id=?1 OR invite_token IN(SELECT token FROM friend_invites WHERE user_id=?1)",[&auth.user_id])?;
    tx.execute(
        "DELETE FROM friend_invites WHERE user_id=?1",
        [&auth.user_id],
    )?;
    for table in [
        "self_feedback",
        "idempotency_keys",
        "analytics_events",
        "pulse_answers",
        "assessments",
        "sessions",
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE user_id=?1"),
            [&auth.user_id],
        )?;
    }
    tx.execute("DELETE FROM users WHERE id=?1", [&auth.user_id])?;
    tx.commit()?;
    Ok((
        StatusCode::NO_CONTENT,
        crate::auth_security::clear_cookie(&state),
    ))
}
