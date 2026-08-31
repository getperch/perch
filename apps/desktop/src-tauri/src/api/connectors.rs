use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

// ── Workspace-level connector config (Settings → Connectors) ──────────────────────────────────────

/// Every connector Perch supports plus this workspace's current config state for each — backs the
/// Connectors page. Secrets are never returned.
#[tauri::command]
pub async fn connector_list(app: AppHandle) -> Result<Vec<GetConnectorsResponseItem>, String> {
    call(&app, Method::GET, "/connectors", None::<&()>).await
}

/// Enter/update one connector's workspace-level credentials. `input.values` is validated
/// server-side against that connector's declared fields.
#[tauri::command]
pub async fn connector_save_config(
    app: AppHandle,
    connector_id: String,
    input: PutConnectorsConnectorIdConfigRequest,
) -> Result<PutConnectorsConnectorIdConfigResponse, String> {
    call(&app, Method::PUT, &format!("/connectors/{connector_id}/config"), Some(&input)).await
}

#[tauri::command]
pub async fn connector_clear_config(app: AppHandle, connector_id: String) -> Result<DeleteConnectorsConnectorIdConfigResponse, String> {
    call(&app, Method::DELETE, &format!("/connectors/{connector_id}/config"), None::<&()>).await
}

// ── Per-agent connect flow (Google Workspace) ────────────────────────────────────────────────────
//
// The `connectors/google-workspace` path segment is fixed here — Google Workspace is the only
// connector with a per-agent connect flow today. A second one adds its own commands + routes.

/// Lets `google_workspace::begin_google_connect` build Google's authorize URL without the OAuth
/// client id or scope list being baked into this binary — see `routers/members.ts`'s
/// `/agents/{memberId}/connectors/google-workspace/authorize`, which returns the workspace OAuth
/// client id plus the least-privilege scope set *this agent* needs (from its own tool grants).
#[tauri::command]
pub async fn google_workspace_authorize(
    app: AppHandle,
    member_id: String,
) -> Result<GetMembersAgentsMemberIdConnectorsConnectorIdAuthorizeResponse, String> {
    call(&app, Method::GET, &format!("/members/agents/{member_id}/connectors/google-workspace/authorize"), None::<&()>).await
}

#[tauri::command]
pub async fn google_workspace_get_connection(
    app: AppHandle,
    member_id: String,
) -> Result<GetMembersAgentsMemberIdConnectorsConnectorIdResponse, String> {
    call(&app, Method::GET, &format!("/members/agents/{member_id}/connectors/google-workspace"), None::<&()>).await
}

#[tauri::command]
pub async fn google_workspace_connect(
    app: AppHandle,
    member_id: String,
    input: PostMembersAgentsMemberIdConnectorsConnectorIdConnectRequest,
) -> Result<PostMembersAgentsMemberIdConnectorsConnectorIdConnectResponse, String> {
    call(&app, Method::POST, &format!("/members/agents/{member_id}/connectors/google-workspace/connect"), Some(&input)).await
}

#[tauri::command]
pub async fn google_workspace_disconnect(
    app: AppHandle,
    member_id: String,
) -> Result<DeleteMembersAgentsMemberIdConnectorsConnectorIdResponse, String> {
    call(&app, Method::DELETE, &format!("/members/agents/{member_id}/connectors/google-workspace"), None::<&()>).await
}
