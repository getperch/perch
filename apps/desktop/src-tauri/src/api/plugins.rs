use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn plugins_list(app: AppHandle, q: Option<String>) -> Result<Vec<GetPluginsResponseItem>, String> {
    let path = match q {
        Some(q) if !q.is_empty() => format!("/plugins?q={q}"),
        _ => "/plugins".to_string(),
    };
    call(&app, Method::GET, &path, None::<&()>).await
}

#[tauri::command]
pub async fn plugins_get(app: AppHandle, name: String, version: String) -> Result<GetPluginsNameVersionResponse, String> {
    call(&app, Method::GET, &format!("/plugins/{name}/{version}"), None::<&()>).await
}

#[tauri::command]
pub async fn plugins_publish(app: AppHandle, input: PostPluginsPublishRequest) -> Result<PostPluginsPublishResponse, String> {
    call(&app, Method::POST, "/plugins/publish", Some(&input)).await
}

#[tauri::command]
pub async fn plugins_import(app: AppHandle, input: PostPluginsImportRequest) -> Result<PostPluginsImportResponse, String> {
    call(&app, Method::POST, "/plugins/import", Some(&input)).await
}
