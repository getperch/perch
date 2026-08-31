use std::sync::Mutex;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::api::connectors as gw_api;
use crate::api::types::{DeleteMembersAgentsMemberIdConnectorsConnectorIdResponse, PostMembersAgentsMemberIdConnectorsConnectorIdConnectRequest, PostMembersAgentsMemberIdConnectorsConnectorIdConnectResponse};

/// Distinct redirect path from `auth.rs`'s own `perch://callback` (that one's for signing into
/// this app itself) so `apps/desktop/src/main.tsx`'s deep-link handler can tell the two flows
/// apart and route each to its own completion command.
const REDIRECT_URI: &str = "perch://google-workspace-callback";

/// Holds the PKCE verifier + the agent (`memberId`) this connect flow is for between
/// `begin_google_connect` opening the browser and `complete_google_connect` finishing the
/// exchange — same pattern as `auth.rs`'s `PendingVerifier`, just also carrying which agent this
/// connection belongs to, since (unlike this app's own sign-in) there can be many independent
/// Google connections, one per agent.
#[derive(Default)]
pub struct PendingGoogleVerifier(Mutex<Option<(String, String)>>);

fn generate_pkce() -> (String, String) {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

/// Starts the PKCE flow for connecting `member_id`'s (an agent's) own Google Workspace. Fetches
/// the OAuth client id *and* this agent's least-privilege scope set from the backend (see
/// `api/connectors.rs`'s `google_workspace_authorize`) rather than hardcoding either — this
/// workspace has no real client id until a workspace admin configures it via Settings →
/// Connectors (`connector_save_config`), and the scope set depends on which tools this
/// specific agent was granted. Fetching both at connect-time means an already-installed app picks
/// up the right values with no rebuild once they're set.
#[tauri::command]
pub async fn begin_google_connect(app: AppHandle, pending: State<'_, PendingGoogleVerifier>, member_id: String) -> Result<(), String> {
    let authorize = gw_api::google_workspace_authorize(app.clone(), member_id.clone()).await?;
    let scopes = authorize.scopes.join(" ");
    let (verifier, challenge) = generate_pkce();

    let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("client_id", &authorize.client_id)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("response_type", "code")
        .append_pair("scope", &scopes)
        // Without both of these, Google only returns a refresh_token on the very first consent
        // ever granted for this client+account — every reconnect after a disconnect would silently
        // fail to get one (see google-oauth.ts's `exchangeGoogleAuthCode` on the backend, which
        // treats a missing refresh_token as an error rather than pretending the connection worked).
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", &challenge);

    *pending.0.lock().unwrap() = Some((member_id, verifier));

    app.opener().open_url(url.to_string(), None::<&str>).map_err(|e| e.to_string())
}

/// Finishes the flow once `perch://google-workspace-callback?code=...` comes back — routed here
/// (instead of `auth::complete_sign_in`) by `apps/desktop/src/main.tsx` based on the callback
/// URL's host. Posts the code + PKCE verifier to the backend, which does the actual token
/// exchange with Google (has the client_secret — this binary never does) and returns the
/// connected account's email for display.
#[tauri::command]
pub async fn complete_google_connect(
    app: AppHandle,
    pending: State<'_, PendingGoogleVerifier>,
    callback_url: String,
) -> Result<PostMembersAgentsMemberIdConnectorsConnectorIdConnectResponse, String> {
    let code = Url::parse(&callback_url)
        .ok()
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "code").map(|(_, v)| v.into_owned()))
        .ok_or("That URL doesn't look like a Google Workspace callback — no code found")?;

    let (member_id, verifier) = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("No Google Workspace connection in progress — click \"Connect Gmail & Calendar\" first")?;

    // typify (build.rs) generates a validated newtype — not a plain String — for any OpenAPI
    // string schema with a `minLength` constraint (all three fields here are `z.string().min(1)`
    // on the services/api side), each with a `FromStr` impl that re-checks that constraint.
    let request = PostMembersAgentsMemberIdConnectorsConnectorIdConnectRequest {
        code: code.parse().map_err(|e: crate::api::types::error::ConversionError| e.to_string())?,
        redirect_uri: REDIRECT_URI.parse().map_err(|e: crate::api::types::error::ConversionError| e.to_string())?,
        code_verifier: verifier.parse().map_err(|e: crate::api::types::error::ConversionError| e.to_string())?,
    };
    gw_api::google_workspace_connect(app, member_id, request).await
}

/// Self-serve disconnect: deletes this agent's stored Google refresh token + connection metadata
/// on the backend. No local state to clear on this side — the PKCE verifier stash is per-connect-
/// attempt and already consumed by the time a connection exists to disconnect.
#[tauri::command]
pub async fn disconnect_google_workspace(app: AppHandle, member_id: String) -> Result<DeleteMembersAgentsMemberIdConnectorsConnectorIdResponse, String> {
    gw_api::google_workspace_disconnect(app, member_id).await
}
