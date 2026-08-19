use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn mentions_list(app: AppHandle) -> Result<Vec<GetMentionsResponseItem>, String> {
    call(&app, Method::GET, "/mentions", None::<&()>).await
}
