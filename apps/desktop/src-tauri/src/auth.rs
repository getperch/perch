use std::sync::Mutex;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::store;

const CLIENT_ID: &str = "fizz-desktop";
const REDIRECT_URI: &str = "fizz://callback";

/// Holds the PKCE verifier between `begin_sign_in` opening the browser and `complete_sign_in`
/// finishing the exchange — mirrors the JS module-level `pendingVerifier` this replaces. In-memory
/// only; the app process stays alive the whole time the browser tab is open.
#[derive(Default)]
pub struct PendingVerifier(Mutex<Option<String>>);

/// Matches `@openauthjs/openauth/client`'s `generatePKCE()` exactly (see `node_modules/@openauthjs/
/// openauth/src/pkce.ts`): a random verifier, base64url-no-pad-encoded, and its SHA-256 challenge,
/// same encoding.
fn generate_pkce() -> (String, String) {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// Starts the PKCE flow: builds `{api_url}/auth/authorize`, stashes the verifier, and opens the
/// system browser directly (not round-tripped back to JS as a URL to open).
#[tauri::command]
pub fn begin_sign_in(app: AppHandle, pending: State<PendingVerifier>) -> Result<(), String> {
    let api_url = store::api_url(&app).ok_or("backend not configured")?;
    let (verifier, challenge) = generate_pkce();

    let mut url = Url::parse(&format!("{api_url}/auth/authorize")).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", CLIENT_ID)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("response_type", "code")
        .append_pair("state", &uuid::Uuid::new_v4().to_string())
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", &challenge);

    *pending.0.lock().unwrap() = Some(verifier);

    app.opener().open_url(url.to_string(), None::<&str>).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
}

/// Finishes the flow once the `fizz://callback?code=...` URL comes back (via the deep-link plugin,
/// or a manually pasted URL as a fallback — see `apps/desktop/src/lib/auth.ts`'s
/// `completeSignIn`). Matches `@openauthjs/openauth/client`'s `exchange()` wire format: one
/// `POST {api_url}/auth/token`, `application/x-www-form-urlencoded`.
#[tauri::command]
pub async fn complete_sign_in(
    app: AppHandle,
    pending: State<'_, PendingVerifier>,
    callback_url: String,
) -> Result<(), String> {
    let code = Url::parse(&callback_url)
        .ok()
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.into_owned()))
        .ok_or("That URL doesn't look like a sign-in callback — no code found")?;

    let verifier = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("No sign-in in progress — click \"Sign in\" first")?;

    let api_url = store::api_url(&app).ok_or("backend not configured")?;
    let client = app.state::<reqwest::Client>();
    let res = client
        .post(format!("{api_url}/auth/token"))
        .form(&[
            ("code", code.as_str()),
            ("redirect_uri", REDIRECT_URI),
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err("Sign-in failed".to_string());
    }
    let tokens: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
    store::save_session(&app, &tokens.access_token, &tokens.refresh_token)
}
