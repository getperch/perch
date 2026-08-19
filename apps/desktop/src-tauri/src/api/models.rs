use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn models_list(app: AppHandle) -> Result<Vec<GetModelsResponseItem>, String> {
    call(&app, Method::GET, "/models", None::<&()>).await
}
