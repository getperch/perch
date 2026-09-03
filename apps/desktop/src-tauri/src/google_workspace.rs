use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::api::connectors as gw_api;
use crate::api::types::{
    DeleteMembersAgentsMemberIdConnectorsConnectorIdResponse, PostMembersAgentsMemberIdConnectorsConnectorIdConnectRequest,
    PostMembersAgentsMemberIdConnectorsConnectorIdConnectResponse,
};

fn generate_pkce() -> (String, String) {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// Connects `member_id`'s (an agent's) own Google Workspace via the OAuth **loopback** flow — the
/// only installed-app redirect Google still accepts for a "Desktop app" client (custom URI schemes
/// like `perch://…` now fail with `Error 400: invalid_request`). Binds a throwaway
/// `http://127.0.0.1:<port>` listener, opens the consent screen in the system browser, waits for
/// Google to redirect back with `?code=…`, and hands the code to the backend for the token
/// exchange (which holds the client secret — this binary never does).
#[tauri::command]
pub async fn begin_google_connect(
    app: AppHandle,
    member_id: String,
) -> Result<PostMembersAgentsMemberIdConnectorsConnectorIdConnectResponse, String> {
    let authorize = gw_api::google_workspace_authorize(app.clone(), member_id.clone()).await?;
    let scopes = authorize.scopes.join(" ");
    let (verifier, challenge) = generate_pkce();

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("couldn't open a local callback port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", &authorize.client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", &scopes)
        // Both are needed or Google only issues a refresh_token on the very first consent for this
        // client+account (see google-oauth.ts's `exchangeGoogleAuthCode`, which treats a missing
        // refresh_token as an error rather than a silent partial success).
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", &challenge);

    app.opener().open_url(url.to_string(), None::<&str>).map_err(|e| e.to_string())?;

    let code = tokio::task::spawn_blocking(move || wait_for_code(listener))
        .await
        .map_err(|e| e.to_string())??;

    // typify (build.rs) generates validated newtypes for the `z.string().min(1)` fields — each
    // `FromStr` re-checks the constraint.
    let request = PostMembersAgentsMemberIdConnectorsConnectorIdConnectRequest {
        code: code.parse().map_err(|e: crate::api::types::error::ConversionError| e.to_string())?,
        redirect_uri: redirect_uri.parse().map_err(|e: crate::api::types::error::ConversionError| e.to_string())?,
        code_verifier: verifier.parse().map_err(|e: crate::api::types::error::ConversionError| e.to_string())?,
    };
    gw_api::google_workspace_connect(app, member_id, request).await
}

/// Blocks (on a worker thread) until Google's browser redirect hits the loopback listener, then
/// returns the `code` query param. Serves a tiny "you can close this tab" page. 5-minute cap.
fn wait_for_code(listener: TcpListener) -> Result<String, String> {
    listener.set_nonblocking(true).ok();
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut line = String::new();
                BufReader::new(&stream).read_line(&mut line).map_err(|e| e.to_string())?;
                // "GET /?code=…&scope=… HTTP/1.1"
                let target = line.split_whitespace().nth(1).unwrap_or("/");
                let parsed = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|e| e.to_string())?;
                let params: HashMap<String, String> = parsed.query_pairs().into_owned().collect();

                let ok = params.contains_key("code");
                let body = if ok {
                    "<!doctype html><meta charset=utf-8><body style=\"font:16px system-ui;padding:48px\">Connected. You can close this tab and return to Perch.</body>"
                } else {
                    "<!doctype html><meta charset=utf-8><body style=\"font:16px system-ui;padding:48px\">Sign-in failed or was cancelled. You can close this tab.</body>"
                };
                let _ = write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.flush();

                if let Some(err) = params.get("error") {
                    return Err(format!("Google returned an error: {err}"));
                }
                return params
                    .get("code")
                    .cloned()
                    .ok_or_else(|| "the Google callback had no authorization code".to_string());
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("timed out waiting for the Google sign-in to finish".into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

/// Self-serve disconnect: deletes this agent's stored Google refresh token + connection metadata.
#[tauri::command]
pub async fn disconnect_google_workspace(
    app: AppHandle,
    member_id: String,
) -> Result<DeleteMembersAgentsMemberIdConnectorsConnectorIdResponse, String> {
    gw_api::google_workspace_disconnect(app, member_id).await
}
