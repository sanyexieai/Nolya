use axum::{
    extract::{FromRequest, FromRequestParts, Request, State},
    http::{request::Parts, HeaderMap, HeaderValue, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use rand::{rngs::OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

pub type ApiResult<T> = Result<T, ApiError>;
#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub &'static str, pub String);
impl ApiError {
    pub fn bad(message: impl Into<String>) -> Self {
        Self(
            StatusCode::UNPROCESSABLE_ENTITY,
            "validation_error",
            message.into(),
        )
    }
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self(StatusCode::FORBIDDEN, "forbidden", message.into())
    }
    pub fn missing() -> Self {
        Self(
            StatusCode::NOT_FOUND,
            "not_found",
            "内容不存在或无权访问".into(),
        )
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self(StatusCode::CONFLICT, "conflict", message.into())
    }
    pub fn unauthorized() -> Self {
        Self(
            StatusCode::UNAUTHORIZED,
            "unauthenticated",
            "请先开始游客体验或登录".into(),
        )
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.0,
            Json(json!({"error":{"code":self.1,"message":self.2,"details":null}})),
        )
            .into_response()
    }
}
impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        tracing::error!(error=%e,"database operation failed");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "暂时无法处理，请重试".into(),
        )
    }
}
impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        tracing::error!(error=%e,"stored JSON invalid");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "数据读取失败".into(),
        )
    }
}

pub struct ApiJson<T>(pub T);
impl<S, T> FromRequest<S> for ApiJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned,
{
    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        let Json(value) = Json::<T>::from_request(req, state).await.map_err(|e| {
            ApiError(
                e.status(),
                "invalid_json",
                "请求格式不正确，请检查字段和选项".into(),
            )
        })?;
        Ok(Self(value))
    }
    type Rejection = ApiError;
}
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub config: Arc<AppConfig>,
    pub password_jobs: Arc<tokio::sync::Semaphore>,
    rate: Arc<Mutex<HashMap<String, (Instant, u32)>>>,
}
#[derive(Clone)]
pub struct AppConfig {
    pub allowed_origins: Vec<String>,
    pub secure_cookie: bool,
    pub session_days: i64,
    pub public_origin: String,
    pub fixed_date: Option<chrono::NaiveDate>,
}
impl Default for AppConfig {
    fn default() -> Self {
        Self {
            allowed_origins: vec![
                "http://127.0.0.1:3000".into(),
                "http://localhost:3000".into(),
                "http://localhost:5173".into(),
                "http://127.0.0.1:5173".into(),
            ],
            secure_cookie: false,
            session_days: 30,
            public_origin: "http://127.0.0.1:3000".into(),
            fixed_date: None,
        }
    }
}
impl AppState {
    pub fn open(path: impl AsRef<Path>, config: AppConfig) -> ApiResult<Self> {
        if !(1..=30).contains(&config.session_days) {
            return Err(ApiError::bad("会话有效期必须为 1–30 天"));
        }
        let mut db = Connection::open(path)?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
        )?;
        let tx = db.transaction()?;
        tx.execute_batch(include_str!("../migrations/001_initial.sql"))?;
        let merge_migrated: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=2)",
            [],
            |r| r.get(0),
        )?;
        if !merge_migrated {
            tx.execute_batch(include_str!("../migrations/002_guest_merge.sql"))?;
        }
        let auth_migrated: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=3)",
            [],
            |r| r.get(0),
        )?;
        if !auth_migrated {
            tx.execute_batch(include_str!("../migrations/003_auth_security.sql"))?;
        }
        tx.commit()?;
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            config: Arc::new(config),
            rate: Arc::new(Mutex::new(HashMap::new())),
            password_jobs: Arc::new(tokio::sync::Semaphore::new(4)),
        })
    }
    pub fn today(&self) -> chrono::NaiveDate {
        self.config
            .fixed_date
            .unwrap_or_else(|| (Utc::now() + chrono::Duration::hours(8)).date_naive())
    }
    pub fn limit(&self, key: String, max: u32) -> ApiResult<()> {
        let mut rates = self.rate.lock().expect("rate lock");
        if rates.len() > 10000 {
            rates.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(60));
        }
        let entry = rates.entry(key).or_insert((Instant::now(), 0));
        if entry.0.elapsed() >= Duration::from_secs(60) {
            *entry = (Instant::now(), 0);
        }
        entry.1 += 1;
        if entry.1 > max {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "rate_limited",
                "操作太频繁，请稍后再试".into(),
            ));
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct Auth {
    pub user_id: String,
    pub csrf_token: String,
    pub token_hash: String,
}
impl<S: Send + Sync> FromRequestParts<S> for Auth {
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, _: &S) -> ApiResult<Self> {
        parts
            .extensions
            .get::<Auth>()
            .cloned()
            .ok_or_else(ApiError::unauthorized)
    }
}
pub fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn random_token() -> String {
    let mut b = [0u8; 32];
    OsRng.fill_bytes(&mut b);
    b.iter().map(|n| format!("{n:02x}")).collect()
}
pub fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
pub fn user_json(db: &Connection, id: &str) -> ApiResult<Value> {
    Ok(db.query_row("SELECT id,kind,username,display_name,locale,region FROM users WHERE id=?1",[id],|r|Ok(json!({"id":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"username":r.get::<_,Option<String>>(2)?,"display_name":r.get::<_,String>(3)?,"locale":r.get::<_,String>(4)?,"region":r.get::<_,String>(5)?})))?)
}
pub fn require_registered(db: &Connection, auth: &Auth) -> ApiResult<()> {
    crate::auth::require_live_session(db, auth)?;
    let kind: String =
        db.query_row("SELECT kind FROM users WHERE id=?1", [&auth.user_id], |r| {
            r.get(0)
        })?;
    if kind != "registered" {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "registration_required",
            "保存为本地账户后可继续积累".into(),
        ));
    }
    Ok(())
}
pub fn issue_session(
    db: &Connection,
    state: &AppState,
    user_id: &str,
) -> ApiResult<(Value, HeaderValue)> {
    db.execute(
        "DELETE FROM sessions WHERE expires_at<=?1",
        [Utc::now().timestamp()],
    )?;
    // Bound session accumulation even for valid credentials used repeatedly.
    db.execute("DELETE FROM sessions WHERE user_id=?1 AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=?1 ORDER BY created_at DESC, rowid DESC LIMIT 19)", [user_id])?;
    let token = random_token();
    let csrf = random_token();
    let max_age = state.config.session_days * 86400;
    db.execute("INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at)VALUES(?1,?2,?3,?4,?5)",params![hash(&token),user_id,csrf,Utc::now().timestamp()+max_age,now()])?;
    let cookie = format!(
        "nolya_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{}",
        if state.config.secure_cookie {
            "; Secure"
        } else {
            ""
        }
    );
    Ok((
        json!({"user":user_json(db,user_id)?,"csrf_token":csrf,"auth_mode":"local_password","session_lifetime_days":state.config.session_days}),
        HeaderValue::from_str(&cookie).expect("valid cookie"),
    ))
}
pub fn idem_read(
    db: &Connection,
    auth: &Auth,
    headers: &HeaderMap,
    scope: &str,
    body: &Value,
) -> ApiResult<(String, String, Option<Value>)> {
    crate::auth::require_live_session(db, auth)?;
    let key = headers
        .get("Idempotency-Key")
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| ApiError::bad("需要 Idempotency-Key 请求标识"))?;
    if key.len() < 16
        || key.len() > 128
        || !key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
    {
        return Err(ApiError::bad("Idempotency-Key 不符合格式"));
    }
    let fingerprint = hash(&serde_json::to_string(body)?);
    let prior:Option<(String,String,bool)>=db.query_row("SELECT fingerprint,response_json,invalidated FROM idempotency_keys WHERE user_id=?1 AND scope=?2 AND key=?3",params![auth.user_id,scope,key],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
    let result = match prior {
        Some((old, response, invalidated)) => {
            if old != fingerprint {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "idempotency_conflict",
                    "同一请求标识不能用于不同内容".into(),
                ));
            }
            if invalidated {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "idempotency_stale",
                    "账户合并后这次旧请求已失效，请刷新内容后重新操作".into(),
                ));
            }
            Some(serde_json::from_str(&response)?)
        }
        None => None,
    };
    Ok((key.into(), fingerprint, result))
}
pub fn idem_save(
    db: &Connection,
    auth: &Auth,
    scope: &str,
    key: &str,
    fingerprint: &str,
    response: &Value,
) -> ApiResult<()> {
    db.execute(
        "INSERT INTO idempotency_keys(user_id,scope,key,fingerprint,response_json,created_at) VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            auth.user_id,
            scope,
            key,
            fingerprint,
            response.to_string(),
            now()
        ],
    )?;
    Ok(())
}
pub fn event(db: &Connection, user: &str, name: &str) -> ApiResult<()> {
    db.execute(
        "INSERT INTO analytics_events(user_id,event,created_at)VALUES(?1,?2,?3)",
        params![user, name, now()],
    )?;
    Ok(())
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Choice {
    A,
    B,
}
impl Choice {
    pub fn score(self) -> i32 {
        if self == Self::A {
            1
        } else {
            -1
        }
    }
    pub fn as_str(self) -> &'static str {
        if self == Self::A {
            "A"
        } else {
            "B"
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Answer {
    pub question_id: String,
    pub choice: Choice,
}

pub async fn security(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let api = req.uri().path().starts_with("/api/");
    let secure = state.config.secure_cookie;
    let mut response = security_inner(state, req, next).await;
    let h = response.headers_mut();
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    h.insert("x-frame-options", HeaderValue::from_static("DENY"));
    h.insert("content-security-policy",HeaderValue::from_static("default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"));
    if api {
        h.insert("cache-control", HeaderValue::from_static("no-store"));
    }
    if secure {
        h.insert(
            "strict-transport-security",
            HeaderValue::from_static("max-age=31536000"),
        );
    }
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        response
            .headers_mut()
            .insert("retry-after", HeaderValue::from_static("60"));
    }
    response
}
async fn security_inner(state: AppState, mut req: Request, next: Next) -> Response {
    let path = req.uri().path().to_owned();
    let mutation = !matches!(
        *req.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    );
    let cookie = req
        .headers()
        .get("cookie")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let token = cookie
        .split(';')
        .find_map(|v| v.trim().strip_prefix("nolya_session="))
        .filter(|t| t.len() == 64)
        .map(hash);
    let auth = if let Some(token_hash) = token {
        let db = state.db.lock().expect("database lock");
        db.query_row(
            "SELECT user_id,csrf_token FROM sessions WHERE token_hash=?1 AND expires_at>?2",
            params![token_hash, Utc::now().timestamp()],
            |r| {
                Ok(Auth {
                    user_id: r.get(0)?,
                    csrf_token: r.get(1)?,
                    token_hash: token_hash.clone(),
                })
            },
        )
        .optional()
        .ok()
        .flatten()
    } else {
        None
    };
    if path.starts_with("/api/") && mutation {
        let origin = req.headers().get("origin").and_then(|v| v.to_str().ok());
        if !origin.is_some_and(|o| {
            state
                .config
                .allowed_origins
                .iter()
                .any(|allowed| allowed == o)
        }) {
            return ApiError::forbidden("请求来源未获允许").into_response();
        }
        if path != "/api/v1/session/guest"
            && (!matches!(path.as_str(), "/api/v1/auth/login" | "/api/v1/auth/recover")
                || auth.is_some())
        {
            let Some(ref auth) = auth else {
                return ApiError::unauthorized().into_response();
            };
            if req
                .headers()
                .get("x-csrf-token")
                .and_then(|h| h.to_str().ok())
                != Some(auth.csrf_token.as_str())
            {
                return ApiError(
                    StatusCode::FORBIDDEN,
                    "csrf_invalid",
                    "安全令牌已失效，请刷新页面".into(),
                )
                .into_response();
            }
        }
        let rate_key = auth
            .as_ref()
            .map(|a| format!("write:{}", a.user_id))
            .unwrap_or_else(|| "write:anonymous".into());
        if let Err(e) = state.limit(rate_key, 120) {
            return e.into_response();
        }
    }
    if let Some(auth) = auth {
        req.extensions_mut().insert(auth);
    }
    next.run(req).await
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.1, self.2)
    }
}
impl std::error::Error for ApiError {}
