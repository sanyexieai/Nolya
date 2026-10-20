mod auth;
mod auth_merge;
mod auth_security;
pub mod catalog;
pub mod core;
mod friends;
mod guess;
mod pulse;
mod self_profile;
mod space;
use axum::{
    extract::{DefaultBodyLimit, Request},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Response},
    routing::{get, patch, post},
    Json, Router,
};
use core::AppState;
use serde_json::json;
use tower_http::services::{ServeDir, ServeFile};
pub fn router(state: AppState, static_dir: Option<&str>) -> Router {
    let api = Router::new()
        .route(
            "/health",
            get(|| async { Json(json!({"status":"ok","version":"0.2.0"})) }),
        )
        .route(
            "/health/live",
            get(|| async { Json(json!({"status":"ok"})) }),
        )
        .route("/health/ready", get(readiness))
        .route("/session", get(auth::session))
        .route("/session/guest", post(auth::guest))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/password", post(auth_security::change_password))
        .route("/auth/logout-all", post(auth_security::logout_all))
        .route(
            "/auth/recovery-code",
            post(auth_security::rotate_recovery_code),
        )
        .route("/auth/recover", post(auth_security::recover))
        .route("/auth/merge/preview", post(auth_merge::preview))
        .route("/auth/merge/confirm", post(auth_merge::confirm))
        .route("/me", patch(auth::profile).delete(auth::delete_account))
        .route("/me/export", get(auth::export))
        .route("/self/questions", get(self_profile::questions))
        .route("/self/assessments", post(self_profile::create))
        .route("/self/latest", get(self_profile::latest))
        .route("/self/history", get(self_profile::history))
        .route(
            "/self/assessments/{id}/feedback",
            post(self_profile::feedback),
        )
        .route("/invites", post(friends::create).get(friends::list))
        .route(
            "/invites/{token}",
            get(friends::get).delete(friends::revoke),
        )
        .route("/invites/{token}/start", post(friends::start))
        .route("/invites/{token}/responses", post(friends::respond))
        .route("/mirror", get(friends::mirror))
        .route("/pulse/today", get(pulse::today))
        .route("/pulse/{id}/answers", post(pulse::answer))
        .route("/journal", get(pulse::journal))
        .route("/journal/entries/{id}", get(pulse::journal_entry))
        .route("/solo", get(pulse::solo))
        .route("/guesses", post(guess::create).get(guess::list))
        .route("/guesses/{token}", get(guess::get).delete(guess::revoke))
        .route("/guesses/{token}/answers", post(guess::answer))
        .route("/guesses/{token}/reverse", post(guess::reverse))
        .route("/space", get(space::get))
        .fallback(|| async { core::ApiError::missing() });
    let app = Router::new().nest("/api/v1", api);
    let app = if let Some(dir) = static_dir {
        let dir = dir.to_owned();
        app.fallback(move |request: Request| serve_frontend(dir.clone(), request))
    } else {
        app
    };
    app.layer(DefaultBodyLimit::max(32 * 1024))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            core::security,
        ))
        .with_state(state)
}

async fn serve_frontend(dir: String, request: Request) -> Response {
    let path = request.uri().path();
    // SPA navigation must never hide a misspelled API route or a missing asset.
    if path == "/api" || path.starts_with("/api/") {
        return core::ApiError::missing().into_response();
    }
    let asset_request = path == "/assets"
        || path.starts_with("/assets/")
        || path.rsplit('/').next().is_some_and(|segment| {
            segment.contains('.') || segment.to_ascii_lowercase().contains("%2e")
        });
    let result = if asset_request {
        ServeDir::new(&dir).try_call(request).await
    } else {
        ServeDir::new(&dir)
            .fallback(ServeFile::new(format!("{dir}/index.html")))
            .try_call(request)
            .await
    };
    match result {
        Ok(response) => response.into_response(),
        Err(error) => {
            tracing::error!(%error, "static file service failed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn readiness(axum::extract::State(state): axum::extract::State<AppState>) -> Response {
    let healthy = state.db.lock().ok().is_some_and(|db| {
        db.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
            .is_ok()
    });
    if healthy {
        Json(json!({"status":"ready"})).into_response()
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"status":"unavailable"})),
        )
            .into_response()
    }
}
