use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn runs_get(app: AppHandle, run_id: String) -> Result<GetRunsRunIdResponse, String> {
    call(&app, Method::GET, &format!("/runs/{run_id}"), None::<&()>).await
}

/// The channel's runs still `"running"`/`"waiting_approval"` — backs ChatScreen's live run
/// indicator on load/reconnect (see services/api/src/routers/runs.ts's `GET /` for why this
/// exists alongside the SSE-driven `run.updated` path).
#[tauri::command]
pub async fn runs_list_active(app: AppHandle, channel_id: String) -> Result<Vec<GetRunsResponseItem>, String> {
    call(&app, Method::GET, &format!("/runs?channelId={channel_id}"), None::<&()>).await
}

/// Gives up on a stuck run — see services/api/src/routers/runs.ts's `POST /{runId}/cancel` for
/// exactly what this does and does not do (marks it failed; doesn't reach into AWS).
#[tauri::command]
pub async fn runs_cancel(app: AppHandle, run_id: String) -> Result<PostRunsRunIdCancelResponse, String> {
    call(&app, Method::POST, &format!("/runs/{run_id}/cancel"), None::<&()>).await
}
