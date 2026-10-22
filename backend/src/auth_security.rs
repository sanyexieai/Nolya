//! Local credential lifecycle. Recovery secrets are generated, shown once, and stored only as digests.
use crate::{
    auth::{require_live_session, verify_credentials, LoginInput},
    core::*,
};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHasher, SaltString},
    Argon2,
};
use axum::{
    extract::State,
    http::{header::SET_COOKIE, HeaderMap, StatusCode},
    Json,
};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PasswordInput {
    current_password: String,
    new_password: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReauthInput {
    current_password: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecoveryInput {
    username: String,
    recovery_code: String,
    new_password: String,
}

pub(crate) fn validate_password(password: &str) -> ApiResult<()> {
    if !(12..=128).contains(&password.chars().count()) || password.len() > 512 {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "weak_password",
            "密码需 12–128 个字符".into(),
        ));
    }
    Ok(())
}
pub(crate) async fn password_hash(state: &AppState, password: String) -> ApiResult<String> {
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
    tokio::task::spawn_blocking(move || {
        // Keep the permit until CPU work ends even if the request is cancelled.
        let _permit = permit;
        Argon2::default()
            .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|h| h.to_string())
    })
    .await
    .map_err(|_| ApiError::bad("密码处理失败"))?
    .map_err(|_| ApiError::bad("密码处理失败"))
}
pub(crate) async fn reauthenticate(
    state: &AppState,
    auth: &Auth,
    password: String,
) -> ApiResult<String> {
    let username = {
        let db = state.db.lock().expect("db");
        require_live_session(&db, auth)?;
        require_registered(&db, auth)?;
        db.query_row(
            "SELECT username FROM users WHERE id=?1",
            [&auth.user_id],
            |r| r.get(0),
        )?
    };
    let (user, verified) = verify_credentials(state, LoginInput { username, password }).await?;
    if user != auth.user_id {
        return Err(ApiError::unauthorized());
    }
    Ok(verified)
}
pub(crate) fn require_verified_password(
    db: &rusqlite::Connection,
    auth: &Auth,
    verified: &str,
) -> ApiResult<()> {
    require_live_session(db, auth)?;
    let valid: bool = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM users WHERE id=?1 AND password_hash=?2 AND kind='registered')",
        params![auth.user_id, verified],
        |r| r.get(0),
    )?;
    if !valid {
        return Err(ApiError::unauthorized());
    }
    Ok(())
}
pub(crate) fn clear_cookie(state: &AppState) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        SET_COOKIE,
        format!(
            "nolya_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{}",
            if state.config.secure_cookie {
                "; Secure"
            } else {
                ""
            }
        )
        .parse()
        .expect("cookie"),
    );
    headers
}
pub async fn change_password(
    State(state): State<AppState>,
    auth: Auth,
    ApiJson(body): ApiJson<PasswordInput>,
) -> ApiResult<(HeaderMap, Json<Value>)> {
    validate_password(&body.new_password)?;
    if body.current_password == body.new_password {
        return Err(ApiError::bad("新密码不能与当前密码相同"));
    }
    let verified = reauthenticate(&state, &auth, body.current_password).await?;
    let new_hash = password_hash(&state, body.new_password).await?;
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    require_verified_password(&tx, &auth, &verified)?;
    // Recovery secrets may also have been compromised. Require creating a fresh one.
    tx.execute(
        "UPDATE users SET password_hash=?1,recovery_code_hash=NULL WHERE id=?2",
        params![new_hash, auth.user_id],
    )?;
    tx.execute("DELETE FROM sessions WHERE user_id=?1", [&auth.user_id])?;
    event(&tx, &auth.user_id, "password_changed")?;
    let (body, cookie) = issue_session(&tx, &state, &auth.user_id)?;
    tx.commit()?;
    let mut headers = HeaderMap::new();
    headers.insert(SET_COOKIE, cookie);
    Ok((headers, Json(body)))
}
pub async fn logout_all(
    State(state): State<AppState>,
    auth: Auth,
) -> ApiResult<(StatusCode, HeaderMap)> {
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    require_live_session(&tx, &auth)?;
    tx.execute("DELETE FROM sessions WHERE user_id=?1", [&auth.user_id])?;
    event(&tx, &auth.user_id, "sessions_revoked")?;
    tx.commit()?;
    Ok((StatusCode::NO_CONTENT, clear_cookie(&state)))
}
pub async fn rotate_recovery_code(
    State(state): State<AppState>,
    auth: Auth,
    ApiJson(body): ApiJson<ReauthInput>,
) -> ApiResult<Json<Value>> {
    let verified = reauthenticate(&state, &auth, body.current_password).await?;
    let code = random_token();
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    require_verified_password(&tx, &auth, &verified)?;
    tx.execute(
        "UPDATE users SET recovery_code_hash=?1 WHERE id=?2",
        params![hash(&code), auth.user_id],
    )?;
    event(&tx, &auth.user_id, "recovery_code_rotated")?;
    tx.commit()?;
    Ok(Json(json!({"recovery_code":code,"shown_once":true})))
}
pub async fn recover(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<RecoveryInput>,
) -> ApiResult<StatusCode> {
    state.limit("recovery_global".into(), 30)?;
    let username = body.username.trim().to_ascii_lowercase();
    state.limit(format!("recovery:{}", hash(&username)), 5)?;
    validate_password(&body.new_password)?;
    let invalid = || {
        ApiError(
            StatusCode::UNAUTHORIZED,
            "invalid_recovery",
            "用户名或恢复码不正确".into(),
        )
    };
    if username.len() > 32
        || body.recovery_code.len() != 64
        || !body.recovery_code.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid());
    }
    let digest = hash(&body.recovery_code);
    let found: Option<(String, String)> = {
        let db = state.db.lock().expect("db");
        db.query_row("SELECT id,password_hash FROM users WHERE username=?1 AND kind='registered' AND recovery_code_hash=?2",params![username,digest],|r| Ok((r.get(0)?,r.get(1)?))).optional()?
    };
    let Some((user, prior_hash)) = found else {
        return Err(invalid());
    };
    let new_hash = password_hash(&state, body.new_password).await?;
    let mut db = state.db.lock().expect("db");
    let tx = db.transaction()?;
    let changed = tx.execute("UPDATE users SET password_hash=?1,recovery_code_hash=NULL WHERE id=?2 AND password_hash=?3 AND recovery_code_hash=?4",params![new_hash,user,prior_hash,digest])?;
    if changed != 1 {
        return Err(invalid());
    }
    tx.execute("DELETE FROM sessions WHERE user_id=?1", [&user])?;
    event(&tx, &user, "account_recovered")?;
    tx.commit()?;
    Ok(StatusCode::NO_CONTENT)
}
