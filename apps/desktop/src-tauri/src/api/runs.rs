use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn runs_get(app: AppHandle, run_id: String) -> Result<GetRunsRunIdResponse, String> {
    call(&app, Method::GET, &format!("/runs/{run_id}"), None::<&()>).await
}
