use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::store;

const CLIENT_ID: &str = "perch-desktop";

async fn send_once<Req: Serialize + ?Sized>(
    app: &AppHandle,
    method: reqwest::Method,
    url: &str,
    body: Option<&Req>,
    extra_headers: &[(&str, &str)],
) -> Result<reqwest::Response, String> {
    let token = store::access_token(app);
    let client = app.state::<reqwest::Client>();

    let mut req = client.request(method, url);
    if let Some(token) = &token {
        req = req.bearer_auth(token);
    }
    for (name, value) in extra_headers {
        req = req.header(*name, *value);
    }
    if let Some(body) = body {
        req = req.json(body);
    }

    req.send().await.map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct RefreshResponse {
    access_token: String,
    refresh_token: String,
}

/// Exchanges the stored refresh token for a new access/refresh pair, same wire format as
/// `auth.rs`'s `complete_sign_in` (`POST {api_url}/auth/token`, form-encoded) but with
/// `grant_type=refresh_token`. OpenAuth rotates the refresh token on every use, so both new
/// tokens are saved — reusing the old refresh token after this would fail.
async fn refresh_session(app: &AppHandle) -> Result<(), String> {
    let api_url = store::api_url(app).ok_or("backend not configured")?;
    let refresh = store::refresh_token(app).ok_or("no refresh token stored")?;
    let client = app.state::<reqwest::Client>();

    let res = client
        .post(format!("{api_url}/auth/token"))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err("refresh failed".to_string());
    }
    let tokens: RefreshResponse = res.json().await.map_err(|e| e.to_string())?;
    store::save_session(app, &tokens.access_token, &tokens.refresh_token)
}

/// Sends one authenticated request, transparently refreshing and retrying once when the failure
/// looks like an expired session before giving up.
///
/// `services/api/src/authorizer.ts` never throws to produce a bare 401 itself — every failure it
/// can produce (missing, malformed, invalid, or *expired* token) returns an explicit `Deny` IAM
/// policy, which API Gateway turns into a 403 carrying an `x-amzn-errortype: AccessDeniedException`
/// header and a `"...explicit deny..."` body. The only way a 401 happens is API Gateway itself
/// short-circuiting *before* invoking that Lambda, when the `Authorization` header is entirely
/// absent. So a routine access-token expiry — the single most common case — surfaces as 403, and
/// treating 403 as unrecoverable forces a needless full re-login.
///
/// But a route can *also* return 403 deliberately (hono `HTTPException(403)` — e.g. "not allowed
/// to do that here"); that one has neither the AWS header nor the AWS body. Only the API-Gateway
/// shape triggers refresh-or-signout — an application 403 is returned to the caller as its own
/// error, so a permissions message never masquerades as "you've been signed out". If refresh
/// fails, or the retried request is still 401/403, *then* the session is cleared.
///
/// `pub(crate)` (not just used via `call`/`call_text` below) so `stream.rs`'s SSE polling loop can
/// go through the same refresh/clear-session contract instead of hand-rolling its own bearer-auth
/// request — it used to do exactly that, which meant an expired token during a long-lived SSE
/// subscription never triggered a refresh or a sign-out, just an infinite loop of failures that a
/// fresh login elsewhere in the app couldn't visibly recover from until the next full app restart.
pub(crate) async fn send_authenticated<Req: Serialize + ?Sized>(
    app: &AppHandle,
    method: reqwest::Method,
    url: &str,
    body: Option<&Req>,
    extra_headers: &[(&str, &str)],
) -> Result<reqwest::Response, String> {
    let res = send_once(app, method.clone(), url, body, extra_headers).await?;
    let status = res.status().as_u16();

    if status != 401 && status != 403 {
        return Ok(res);
    }

    let amzn_access_denied = res
        .headers()
        .get("x-amzn-errortype")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("AccessDenied"));
    // Safe to consume the body here: this branch is a 401/403, never a success `call` needs to read.
    let error_body = res.text().await.unwrap_or_default();
    let is_expired_session = status == 401 || amzn_access_denied || error_body.contains("explicit deny");

    if !is_expired_session {
        // A route's own 403 — hand its message back to the caller instead of signing them out.
        return Err(error_body);
    }

    if refresh_session(app).await.is_err() {
        let _ = store::clear_session(app);
        return Err("signed out".to_string());
    }
    let retried = send_once(app, method, url, body, extra_headers).await?;
    if retried.status().as_u16() == 401 || retried.status().as_u16() == 403 {
        let _ = store::clear_session(app);
        return Err("signed out".to_string());
    }
    Ok(retried)
}

/// Shared by every `api/*.rs` command: builds `{api_url}/api{path}`, attaches the bearer token
/// from the store (refreshing it transparently on a 401 — see `send_authenticated`), and clears
/// the stored session if that doesn't recover it — mirroring the `signOut()`-on-401/403 behavior
/// that used to live in the frontend's `trpc.ts`/`api-client.ts`, now from the Rust side.
pub async fn call<Req: Serialize + ?Sized, Res: DeserializeOwned>(
    app: &AppHandle,
    method: reqwest::Method,
    path: &str,
    body: Option<&Req>,
) -> Result<Res, String> {
    let api_url = store::api_url(app).ok_or("backend not configured")?;
    let res = send_authenticated(app, method, &format!("{api_url}/api{path}"), body, &[]).await?;

    if !res.status().is_success() {
        return Err(res.text().await.unwrap_or_else(|_| "request failed".to_string()));
    }

    res.json::<Res>().await.map_err(|e| e.to_string())
}

/// Sibling of `call` for endpoints that return a raw text body rather than JSON (e.g. artifact
/// content). Unlike `call`, `url` is used as-is rather than joined onto `{api_url}/api{path}` —
/// callers pass an already-absolute URL (such as `ArtifactRef.url`) — but the same auth/refresh
/// behavior applies.
pub async fn call_text(app: &AppHandle, method: reqwest::Method, url: &str) -> Result<String, String> {
    let res = send_authenticated::<()>(app, method, url, None, &[]).await?;

    if !res.status().is_success() {
        return Err(res.text().await.unwrap_or_else(|_| "request failed".to_string()));
    }

    res.text().await.map_err(|e| e.to_string())
}
