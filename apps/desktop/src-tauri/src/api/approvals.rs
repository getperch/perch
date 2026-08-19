use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn approvals_resolve(
    app: AppHandle,
    approval_id: String,
    input: PostApprovalsApprovalIdResolveRequest,
) -> Result<PostApprovalsApprovalIdResolveResponse, String> {
    call(&app, Method::POST, &format!("/approvals/{approval_id}/resolve"), Some(&input)).await
}
