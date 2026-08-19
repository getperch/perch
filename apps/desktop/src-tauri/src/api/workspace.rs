use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn workspace_get(app: AppHandle) -> Result<GetWorkspaceResponse, String> {
    call(&app, Method::GET, "/workspace", None::<&()>).await
}

#[tauri::command]
pub async fn workspace_update_spend_cap(
    app: AppHandle,
    input: PatchWorkspaceSpendCapRequest,
) -> Result<PatchWorkspaceSpendCapResponse, String> {
    call(&app, Method::PATCH, "/workspace/spend-cap", Some(&input)).await
}

#[tauri::command]
pub async fn workspace_get_spend(app: AppHandle) -> Result<GetWorkspaceSpendResponse, String> {
    call(&app, Method::GET, "/workspace/spend", None::<&()>).await
}

#[tauri::command]
pub async fn workspace_update_settings(
    app: AppHandle,
    input: PatchWorkspaceSettingsRequest,
) -> Result<PatchWorkspaceSettingsResponse, String> {
    call(&app, Method::PATCH, "/workspace/settings", Some(&input)).await
}
