use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn tasks_list(app: AppHandle, channel_id: Option<String>) -> Result<Vec<GetTasksResponseItem>, String> {
    let path = match channel_id {
        Some(id) => format!("/tasks?channelId={id}"),
        None => "/tasks".to_string(),
    };
    call(&app, Method::GET, &path, None::<&()>).await
}

#[tauri::command]
pub async fn tasks_create(app: AppHandle, input: PostTasksRequest) -> Result<PostTasksResponse, String> {
    call(&app, Method::POST, "/tasks", Some(&input)).await
}

#[tauri::command]
pub async fn tasks_update(app: AppHandle, task_id: String, input: PatchTasksTaskIdRequest) -> Result<PatchTasksTaskIdResponse, String> {
    call(&app, Method::PATCH, &format!("/tasks/{task_id}"), Some(&input)).await
}
