use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use nolya_api::{
    core::{AppConfig, AppState},
    router,
};
use serde_json::{json, Value};
use tower::ServiceExt;
const ORIGIN: &str = "http://127.0.0.1:3000";
#[derive(Clone)]
struct Client {
    cookie: String,
    csrf: String,
}
async fn request(
    app: &Router,
    client: Option<&Client>,
    method: &str,
    path: &str,
    body: Option<Value>,
    key: Option<&str>,
) -> (StatusCode, Value, Option<String>) {
    let mut req = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("origin", ORIGIN);
    if let Some(c) = client {
        req = req
            .header("cookie", &c.cookie)
            .header("x-csrf-token", &c.csrf)
    }
    if let Some(k) = key {
        req = req.header("idempotency-key", k)
    }
    let req = if let Some(body) = body {
        req.header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    } else {
        req.body(Body::empty()).unwrap()
    };
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let cookie = resp
        .headers()
        .get("set-cookie")
        .map(|v| v.to_str().unwrap().split(';').next().unwrap().to_owned());
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, value, cookie)
}
async fn guest(app: &Router) -> Client {
    let (s, v, c) = request(app, None, "POST", "/session/guest", Some(json!({})), None).await;
    assert_eq!(s, StatusCode::OK);
    Client {
        cookie: c.unwrap(),
        csrf: v["csrf_token"].as_str().unwrap().to_owned(),
    }
}
fn setup() -> (tempfile::TempDir, AppState, Router) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::open(dir.path().join("db.sqlite"), AppConfig::default()).unwrap();
    let app = router(state.clone(), None);
    (dir, state, app)
}
async fn assess(app: &Router, c: &Client) -> Value {
    let (_, bank, _) = request(app, Some(c), "GET", "/self/questions", None, None).await;
    let body = json!({"version":bank["version"],"answers":bank["questions"].as_array().unwrap().iter().map(|q|json!({"question_id":q["id"],"choice":"A"})).collect::<Vec<_>>()});
    let (s, v, _) = request(
        app,
        Some(c),
        "POST",
        "/self/assessments",
        Some(body),
        Some("test-self-0000001"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}
#[tokio::test]
async fn persistent_sessions_isolation_and_scoring() {
    let (dir, _, app) = setup();
    let a = guest(&app).await;
    let b = guest(&app).await;
    assert_ne!(a.cookie, b.cookie);
    let result = assess(&app, &a).await;
    assert_eq!(result["dimensions"].as_array().unwrap().len(), 4);
    assert!(result["dimensions"]
        .as_array()
        .unwrap()
        .iter()
        .all(|d| d["score"] == 1));
    assert_eq!(result["target_dimensions"], json!(["D1", "D2", "D4"]));
    let (_, empty, _) = request(&app, Some(&b), "GET", "/self/latest", None, None).await;
    assert!(empty.is_null());
    drop(app);
    let state = AppState::open(dir.path().join("db.sqlite"), AppConfig::default()).unwrap();
    let app = router(state, None);
    let (s, saved, _) = request(&app, Some(&a), "GET", "/self/latest", None, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(saved, result);
}
#[tokio::test]
async fn idempotency_malformed_and_csrf() {
    let (_, _, app) = setup();
    let a = guest(&app).await;
    let result = assess(&app, &a).await;
    let repeat = assess(&app, &a).await;
    assert_eq!(repeat["id"], result["id"]);
    let body = json!({"version":"1.0","answers":[]});
    let (s, _, _) = request(
        &app,
        Some(&a),
        "POST",
        "/self/assessments",
        Some(body),
        Some("bad-request-000001"),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let bad = Client {
        csrf: "wrong".into(),
        ..a.clone()
    };
    let (s, _, _) = request(
        &app,
        Some(&bad),
        "POST",
        "/invites",
        Some(json!({"self_assessment_id":result["id"]})),
        Some("test-invite-00001"),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let no_origin = Request::builder()
        .method("POST")
        .uri("/api/v1/session/guest")
        .header("content-type", "application/json")
        .body(Body::from("{}"))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(no_origin).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn pulse_is_gated_immutable_and_versioned() {
    let (_, state, app) = setup();
    let a = guest(&app).await;
    let (_, before, _) = request(&app, Some(&a), "GET", "/pulse/today", None, None).await;
    assert!(before["crowd"].is_null());
    let path = format!("/pulse/{}/answers", before["id"].as_str().unwrap());
    let (s, after, _) = request(
        &app,
        Some(&a),
        "POST",
        &path,
        Some(json!({"choice":"A"})),
        Some("test-pulse-000001"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{after}");
    assert_eq!(after["crowd"]["sample_size"], 1);
    assert!(after["crowd"]["a_percent"].is_null());
    let (s, _, _) = request(
        &app,
        Some(&a),
        "POST",
        &path,
        Some(json!({"choice":"B"})),
        Some("test-pulse-000002"),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let db = state.db.lock().unwrap();
    let stored: String = db
        .query_row("SELECT question_json FROM pulse_answers", [], |r| r.get(0))
        .unwrap();
    assert!(stored.contains("version"));
}
#[tokio::test]
async fn guess_secrecy_replay_and_revocation() {
    let (_, _, app) = setup();
    let owner = guest(&app).await;
    let peer = guest(&app).await;
    let outsider = guest(&app).await;
    let self_result = assess(&app, &owner).await;
    let (s, link, _) = request(
        &app,
        Some(&owner),
        "POST",
        "/guesses",
        Some(json!({"source_type":"self","answer_id":self_result["answers"][0]["id"]})),
        Some("test-guess-000001"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{link}");
    let route = format!("/guesses/{}", link["token"].as_str().unwrap());
    let (_, context, _) = request(&app, Some(&peer), "GET", &route, None, None).await;
    assert!(context["reveal"].is_null());
    assert!(!context.to_string().contains("actual_choice"));
    let (s, reveal, _) = request(
        &app,
        Some(&peer),
        "POST",
        &format!("{route}/answers"),
        Some(json!({"choice":"B"})),
        Some("test-reveal-00001"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{reveal}");
    assert_eq!(reveal["actual_choice"], "A");
    assert_eq!(reveal["correct"], false);
    assert_eq!(context["is_directed"], false);
    let (s, reverse, _) = request(
        &app,
        Some(&peer),
        "POST",
        &format!("{route}/reverse"),
        Some(json!({"choice":"B"})),
        Some("test-reverse-0001"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{reverse}");
    let reverse_route = format!("/guesses/{}", reverse["token"].as_str().unwrap());
    let (_, own_reverse, _) = request(&app, Some(&peer), "GET", &reverse_route, None, None).await;
    assert_eq!(own_reverse["is_directed"], true);
    assert_eq!(own_reverse["is_owner"], true);
    assert!(own_reverse.get("target_user_id").is_none());
    let (_, managed, _) = request(&app, Some(&peer), "GET", "/guesses", None, None).await;
    assert_eq!(managed["rounds"][0]["source_type"], "reverse");
    let (s, _, _) = request(&app, Some(&outsider), "GET", &reverse_route, None, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let (_, secret, _) = request(&app, Some(&outsider), "GET", &route, None, None).await;
    assert!(secret["reveal"].is_null());
    let (s, _, _) = request(
        &app,
        Some(&owner),
        "DELETE",
        &route,
        None,
        Some("test-revoke-00001"),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _, _) = request(&app, Some(&peer), "GET", &route, None, None).await;
    assert_eq!(s, StatusCode::GONE);
}
#[tokio::test]
async fn three_friends_form_real_mirror() {
    let (_, _, app) = setup();
    let owner = guest(&app).await;
    let self_result = assess(&app, &owner).await;
    let (_, link, _) = request(
        &app,
        Some(&owner),
        "POST",
        "/invites",
        Some(json!({"self_assessment_id":self_result["id"]})),
        Some("test-invite-00001"),
    )
    .await;
    let route = format!("/invites/{}", link["token"].as_str().unwrap());
    for n in 1..=3 {
        let peer = guest(&app).await;
        let (s, start, _) = request(
            &app,
            Some(&peer),
            "POST",
            &format!("{route}/start"),
            Some(json!({"consent":true})),
            Some("test-start-000001"),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{start}");
        assert!(start["questions"]
            .as_array()
            .unwrap()
            .iter()
            .all(|q| q["id"] != "FRIEND-D1-A"));
        let payload = json!({"session_id":start["session_id"],"answers":start["questions"].as_array().unwrap().iter().map(|q|json!({"question_id":q["id"],"choice":"A"})).collect::<Vec<_>>()});
        let (s, v, _) = request(
            &app,
            Some(&peer),
            "POST",
            &format!("{route}/responses"),
            Some(payload.clone()),
            Some("test-respond-0001"),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let (s, _, _) = request(
            &app,
            Some(&peer),
            "POST",
            &format!("{route}/responses"),
            Some(payload),
            Some("test-respond-0002"),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        let (_, mirror, _) = request(&app, Some(&owner), "GET", "/mirror", None, None).await;
        assert_eq!(mirror["completed_count"], n);
        assert!(mirror["comparisons"]
            .as_array()
            .unwrap()
            .iter()
            .all(|q| q["relation"] == if n == 3 { "aligned" } else { "insufficient" }));
    }
}
#[test]
fn catalog_is_four_dimensions_thirty_daily_questions() {
    let self_q = nolya_api::catalog::self_questions();
    assert_eq!(self_q.len(), 8);
    assert_eq!(
        nolya_api::catalog::questions()
            .iter()
            .filter(|q| q.form == "pulse")
            .count(),
        30
    );
    let qs = nolya_api::catalog::friend_questions(&["D1".into(), "D2".into(), "D4".into()], 0);
    assert!(qs.iter().all(|q| q.version == "1.0" && q.direction_a == 1));
}

#[tokio::test]
async fn expiry_and_daily_rollover_are_server_authoritative() {
    let (_dir, state, app) = setup();
    let user = guest(&app).await;
    let (_, pulse, _) = request(&app, Some(&user), "GET", "/pulse/today", None, None).await;
    let mut tomorrow = state.clone();
    let mut config = (*tomorrow.config).clone();
    config.fixed_date = Some(state.today().succ_opt().unwrap());
    tomorrow.config = std::sync::Arc::new(config);
    let app_tomorrow = router(tomorrow, None);
    let stale = format!("/pulse/{}/answers", pulse["id"].as_str().unwrap());
    let (status, result, _) = request(
        &app_tomorrow,
        Some(&user),
        "POST",
        &stale,
        Some(json!({"choice":"A"})),
        Some("expired-pulse-0001"),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(result["error"]["code"], "pulse_expired");
    let assessment = assess(&app, &user).await;
    let (_, invite, _) = request(
        &app,
        Some(&user),
        "POST",
        "/invites",
        Some(json!({"self_assessment_id":assessment["id"]})),
        Some("expiring-invite-01"),
    )
    .await;
    state
        .db
        .lock()
        .unwrap()
        .execute("UPDATE friend_invites SET expires_at=0", [])
        .unwrap();
    let (status, _, _) = request(
        &app,
        Some(&user),
        "GET",
        &format!("/invites/{}", invite["token"].as_str().unwrap()),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::GONE);
    state
        .db
        .lock()
        .unwrap()
        .execute("UPDATE sessions SET expires_at=0", [])
        .unwrap();
    let (status, _, _) = request(&app, Some(&user), "GET", "/space", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn account_upgrade_rotates_session_and_deletion_purges_peer_disclosures() {
    let (_dir, state, app) = setup();
    let owner = guest(&app).await;
    let peer = guest(&app).await;
    let result = assess(&app, &owner).await;
    let (_, link, _) = request(
        &app,
        Some(&owner),
        "POST",
        "/guesses",
        Some(json!({"source_type":"self","answer_id":result["answers"][0]["id"]})),
        Some("deletion-guess-01"),
    )
    .await;
    let route = format!("/guesses/{}", link["token"].as_str().unwrap());
    let (status, _, _) = request(
        &app,
        Some(&peer),
        "POST",
        &format!("{route}/answers"),
        Some(json!({"choice":"A"})),
        Some("deletion-reveal-01"),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, upgraded, cookie) = request(&app,Some(&owner),"POST","/auth/register",Some(json!({"username":"real_account","password":"safe-test-password-123","display_name":"本地账户"})),None).await;
    assert_eq!(status, StatusCode::OK, "{upgraded}");
    assert_eq!(upgraded["user"]["kind"], "registered");
    let registered = Client {
        cookie: cookie.unwrap(),
        csrf: upgraded["csrf_token"].as_str().unwrap().into(),
    };
    assert_ne!(registered.cookie, owner.cookie);
    let (status, _, _) = request(&app, Some(&owner), "GET", "/self/latest", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (_, saved, _) = request(&app, Some(&registered), "GET", "/self/latest", None, None).await;
    assert_eq!(saved["id"], result["id"]);
    let (_, export, _) = request(&app, Some(&registered), "GET", "/me/export", None, None).await;
    assert!(!export.to_string().contains("password_hash"));
    assert!(!export.to_string().contains("csrf_token"));
    let (status, _, _) = request(
        &app,
        Some(&registered),
        "DELETE",
        "/me",
        Some(json!({"confirmation":"DELETE","password":"safe-test-password-123"})),
        Some("account-delete-001"),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let db = state.db.lock().unwrap();
    let caches: i64 = db
        .query_row(
            "SELECT count(*) FROM idempotency_keys WHERE scope LIKE 'guesses.answer:%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(caches, 0);
    let people: i64 = db
        .query_row("SELECT count(*) FROM users", [], |r| r.get(0))
        .unwrap();
    assert_eq!(people, 1);
}

#[tokio::test]
async fn static_spa_deep_links_are_200_but_api_and_asset_misses_are_404() {
    let (_dir, state, _) = setup();
    let frontend = tempfile::tempdir().unwrap();
    std::fs::create_dir(frontend.path().join("assets")).unwrap();
    std::fs::write(
        frontend.path().join("index.html"),
        "<!doctype html><title>Nolya SPA</title>",
    )
    .unwrap();
    std::fs::write(
        frontend.path().join("assets/app.js"),
        "console.log('asset');",
    )
    .unwrap();
    let app = router(state, Some(frontend.path().to_str().unwrap()));
    for path in [
        "/",
        "/self",
        "/self/result",
        "/mirror",
        "/today",
        "/journal",
        "/space",
        "/account",
        "/invite",
        "/friend/opaque-token",
        "/guess/new",
        "/guess/opaque-token",
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "SPA navigation {path}");
        assert!(response.headers()["content-type"]
            .to_str()
            .unwrap()
            .starts_with("text/html"));
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(String::from_utf8_lossy(&body).contains("Nolya SPA"));
    }
    for path in [
        "/api",
        "/api/unknown",
        "/api/v1/unknown",
        "/api/v2/health",
        "/assets/missing.js",
        "/assets/no-extension",
        "/missing.css",
        "/missing.png",
        "/favicon.ico",
    ] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::NOT_FOUND,
            "missing resource {path}"
        );
        let body = response.into_body().collect().await.unwrap().to_bytes();
        assert!(!String::from_utf8_lossy(&body).contains("Nolya SPA"));
    }
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/assets/app.js")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("HEAD")
                .uri("/mirror")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response
        .into_body()
        .collect()
        .await
        .unwrap()
        .to_bytes()
        .is_empty());
}
