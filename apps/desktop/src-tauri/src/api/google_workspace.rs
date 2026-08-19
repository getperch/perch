use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

/// Lets `google_workspace::begin_google_connect` build Google's authorize URL without the OAuth
/// client id being baked into this binary at compile time, AND without hardcoding a scope list —
/// see `routers/members.ts`'s `/agents/{memberId}/google-workspace/authorize`, which returns the
/// workspace OAuth client id plus the least-privilege scope set *this agent* needs (from its own
/// tool grants). Returns a clear error (surfaced by `call`'s non-2xx handling) if a workspace admin
/// hasn't configured the Google OAuth client in Settings → Integrations yet, or if the agent has no
/// Gmail/Calendar tool granted.
#[tauri::command]
pub async fn google_workspace_authorize(
    app: AppHandle,
    member_id: String,
) -> Result<GetMembersAgentsMemberIdGoogleWorkspaceAuthorizeResponse, String> {
    call(&app, Method::GET, &format!("/members/agents/{member_id}/google-workspace/authorize"), None::<&()>).await
}

#[tauri::command]
pub async fn google_workspace_get_connection(app: AppHandle, member_id: String) -> Result<GetMembersAgentsMemberIdGoogleWorkspaceResponse, String> {
    call(&app, Method::GET, &format!("/members/agents/{member_id}/google-workspace"), None::<&()>).await
}

#[tauri::command]
pub async fn google_workspace_connect(
    app: AppHandle,
    member_id: String,
    input: PostMembersAgentsMemberIdGoogleWorkspaceConnectRequest,
) -> Result<PostMembersAgentsMemberIdGoogleWorkspaceConnectResponse, String> {
    call(&app, Method::POST, &format!("/members/agents/{member_id}/google-workspace/connect"), Some(&input)).await
}

#[tauri::command]
pub async fn google_workspace_disconnect(app: AppHandle, member_id: String) -> Result<DeleteMembersAgentsMemberIdGoogleWorkspaceResponse, String> {
    call(&app, Method::DELETE, &format!("/members/agents/{member_id}/google-workspace"), None::<&()>).await
}

/// Backs the Settings screen's Google Workspace card — the one workspace-level OAuth client
/// (distinct from `google_workspace_get_connection` above, which is per-agent), configured at
/// runtime instead of a deploy-time `sst secret set`. Never returns the secret.
#[tauri::command]
pub async fn google_workspace_get_client_status(app: AppHandle) -> Result<GetGoogleWorkspaceStatusResponse, String> {
    call(&app, Method::GET, "/google-workspace/status", None::<&()>).await
}

#[tauri::command]
pub async fn google_workspace_save_client(
    app: AppHandle,
    input: PutGoogleWorkspaceClientRequest,
) -> Result<PutGoogleWorkspaceClientResponse, String> {
    call(&app, Method::PUT, "/google-workspace/client", Some(&input)).await
}

#[tauri::command]
pub async fn google_workspace_clear_client(app: AppHandle) -> Result<DeleteGoogleWorkspaceClientResponse, String> {
    call(&app, Method::DELETE, "/google-workspace/client", None::<&()>).await
}
