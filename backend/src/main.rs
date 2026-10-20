use nolya_api::{
    core::{AppConfig, AppState},
    router,
};
use std::{env, path::Path};

fn validate_origin(origin: &str, production: bool) -> Result<(), String> {
    if origin.contains(['#', '\\']) || origin.chars().any(char::is_whitespace) {
        return Err("invalid origin characters".into());
    }
    let uri = origin
        .parse::<axum::http::Uri>()
        .map_err(|_| "invalid origin")?;
    let scheme = uri.scheme_str().ok_or("origin requires scheme")?;
    let authority = uri.authority().ok_or("origin requires host")?;
    if !["http", "https"].contains(&scheme)
        || (production && scheme != "https")
        || authority.as_str().contains('@')
        || authority.as_str().contains('*')
        || uri.query().is_some()
        || !["", "/"].contains(&uri.path())
    {
        return Err("origin must be an exact HTTP(S) origin without credentials, path or wildcard; production requires HTTPS".into());
    }
    if production && ["localhost", "127.0.0.1", "[::1]"].contains(&authority.host()) {
        return Err("production origin must use the public hostname".into());
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "nolya_api=info".into()),
        )
        .init();
    let mode = env::var("NOLYA_ENV").unwrap_or_else(|_| "development".into());
    if !["development", "production"].contains(&mode.as_str()) {
        return Err("NOLYA_ENV must be development or production".into());
    }
    let production = mode == "production";
    let bind = env::var("NOLYA_BIND").unwrap_or_else(|_| "127.0.0.1:3000".into());
    let _: std::net::SocketAddr = bind.parse()?;
    let db_path = env::var("NOLYA_DB_PATH").unwrap_or_else(|_| "data/nolya.sqlite".into());
    let mut config = AppConfig::default();
    if let Ok(origin) = env::var("NOLYA_PUBLIC_ORIGIN") {
        config.public_origin = origin.trim_end_matches('/').to_owned();
    } else if production {
        return Err("production requires explicit NOLYA_PUBLIC_ORIGIN".into());
    }
    if let Ok(origins) = env::var("NOLYA_ALLOWED_ORIGINS") {
        config.allowed_origins = origins
            .split(',')
            .map(|s| s.trim().trim_end_matches('/').to_owned())
            .filter(|s| !s.is_empty())
            .collect();
    } else if production {
        return Err("production requires explicit NOLYA_ALLOWED_ORIGINS".into());
    }
    config.secure_cookie = match env::var("NOLYA_COOKIE_SECURE").as_deref() {
        Ok("true") => true,
        Ok("false") | Err(_) => false,
        _ => return Err("NOLYA_COOKIE_SECURE must be true or false".into()),
    };
    if let Ok(days) = env::var("NOLYA_SESSION_DAYS") {
        config.session_days = days.parse()?;
    }
    if !(1..=30).contains(&config.session_days) {
        return Err("NOLYA_SESSION_DAYS must be 1–30".into());
    }
    validate_origin(&config.public_origin, production)?;
    if config.allowed_origins.is_empty() {
        return Err("at least one allowed origin is required".into());
    }
    for origin in &config.allowed_origins {
        validate_origin(origin, production)?;
    }
    if !config.allowed_origins.contains(&config.public_origin) {
        return Err("public origin must appear in allowed origins".into());
    }
    if (production || config.public_origin.starts_with("https://")) && !config.secure_cookie {
        return Err("HTTPS and production require NOLYA_COOKIE_SECURE=true".into());
    }
    let static_dir = env::var("NOLYA_STATIC_DIR").unwrap_or_else(|_| "frontend/dist".into());
    if production && !Path::new(&static_dir).join("index.html").is_file() {
        return Err("production frontend build is missing".into());
    }
    if let Some(parent) = Path::new(&db_path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    let state = AppState::open(db_path, config)?;
    let app = router(state, Some(&static_dir));
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(address=%bind, mode=%mode, "Nolya ready");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}
async fn shutdown() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_production_origins_only() {
        for bad in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://*.example.com",
            "https://example.com/path",
            "https://example.com?x=1",
            "https://localhost",
            "https://127.0.0.1",
            "https://[::1]",
            "javascript:alert(1)",
            "https://example.com#fragment",
        ] {
            assert!(validate_origin(bad, true).is_err(), "{bad}");
        }
        assert!(validate_origin("https://nolya.example.com", true).is_ok());
        assert!(validate_origin("http://127.0.0.1:3000", false).is_ok());
    }
}
