use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn procedures_list(app: AppHandle) -> Result<Vec<GetProceduresResponseItem>, String> {
    call(&app, Method::GET, "/procedures", None::<&()>).await
}

#[tauri::command]
pub async fn procedures_get(app: AppHandle, procedure_id: String) -> Result<GetProceduresProcedureIdResponse, String> {
    call(&app, Method::GET, &format!("/procedures/{procedure_id}"), None::<&()>).await
}

#[tauri::command]
pub async fn procedures_create(app: AppHandle, input: PostProceduresRequest) -> Result<PostProceduresResponse, String> {
    call(&app, Method::POST, "/procedures", Some(&input)).await
}

#[tauri::command]
pub async fn procedures_update(
    app: AppHandle,
    procedure_id: String,
    input: PatchProceduresProcedureIdRequest,
) -> Result<PatchProceduresProcedureIdResponse, String> {
    call(&app, Method::PATCH, &format!("/procedures/{procedure_id}"), Some(&input)).await
}

#[tauri::command]
pub async fn procedures_delete(app: AppHandle, procedure_id: String) -> Result<DeleteProceduresProcedureIdResponse, String> {
    call(&app, Method::DELETE, &format!("/procedures/{procedure_id}"), None::<&()>).await
}

#[tauri::command]
pub async fn procedures_secret_put(
    app: AppHandle,
    procedure_id: String,
    key: String,
    input: PutProceduresProcedureIdSecretsKeyRequest,
) -> Result<PutProceduresProcedureIdSecretsKeyResponse, String> {
    call(&app, Method::PUT, &format!("/procedures/{procedure_id}/secrets/{key}"), Some(&input)).await
}

#[tauri::command]
pub async fn procedures_secret_delete(
    app: AppHandle,
    procedure_id: String,
    key: String,
) -> Result<DeleteProceduresProcedureIdSecretsKeyResponse, String> {
    call(&app, Method::DELETE, &format!("/procedures/{procedure_id}/secrets/{key}"), None::<&()>).await
}

#[tauri::command]
pub async fn procedures_run(app: AppHandle, procedure_id: String) -> Result<PostProceduresProcedureIdRunResponse, String> {
    call(&app, Method::POST, &format!("/procedures/{procedure_id}/run"), None::<&()>).await
}
