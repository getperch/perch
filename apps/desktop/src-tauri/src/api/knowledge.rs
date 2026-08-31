use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

/// `/knowledge/*` — the human window onto the workspace's OKF knowledge bundle. Browse every
/// concept, read one, curate `<domain>/` docs, mark a fact human-verified, and rebuild the index.
/// Writes are gated to workspace owners/admins on the API side (see
/// `services/api/src/routers/knowledge.ts`); `verify` is open to any member.
#[tauri::command]
pub async fn knowledge_list(app: AppHandle) -> Result<GetKnowledgeResponse, String> {
    call(&app, Method::GET, "/knowledge", None::<&()>).await
}

#[tauri::command]
pub async fn knowledge_get(app: AppHandle, path: String) -> Result<GetKnowledgeDocResponse, String> {
    // `path` carries `/` and `.md` — percent-encode it into the single `path` query param.
    let encoded: String = url::form_urlencoded::byte_serialize(path.as_bytes()).collect();
    call(&app, Method::GET, &format!("/knowledge/doc?path={encoded}"), None::<&()>).await
}

#[tauri::command]
pub async fn knowledge_put(app: AppHandle, input: PutKnowledgeDocRequest) -> Result<PutKnowledgeDocResponse, String> {
    call(&app, Method::PUT, "/knowledge/doc", Some(&input)).await
}

#[tauri::command]
pub async fn knowledge_deprecate(app: AppHandle, input: DeleteKnowledgeDocRequest) -> Result<DeleteKnowledgeDocResponse, String> {
    call(&app, Method::DELETE, "/knowledge/doc", Some(&input)).await
}

#[tauri::command]
pub async fn knowledge_verify(app: AppHandle, input: PostKnowledgeVerifyRequest) -> Result<PostKnowledgeVerifyResponse, String> {
    call(&app, Method::POST, "/knowledge/verify", Some(&input)).await
}

#[tauri::command]
pub async fn knowledge_reindex(app: AppHandle) -> Result<PostKnowledgeReindexResponse, String> {
    call(&app, Method::POST, "/knowledge/reindex", None::<&()>).await
}
