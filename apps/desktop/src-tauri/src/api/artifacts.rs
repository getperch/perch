use reqwest::Method;
use tauri::AppHandle;

use super::client::call_text;

#[tauri::command]
pub async fn artifacts_get_content(app: AppHandle, url: String) -> Result<String, String> {
    call_text(&app, Method::GET, &url).await
}
