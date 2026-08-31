use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn members_me(app: AppHandle) -> Result<GetMembersMeResponse, String> {
    call(&app, Method::GET, "/members/me", None::<&()>).await
}

#[tauri::command]
pub async fn members_list(app: AppHandle) -> Result<Vec<GetMembersResponseItem>, String> {
    call(&app, Method::GET, "/members", None::<&()>).await
}

#[tauri::command]
pub async fn members_create_person(app: AppHandle, input: PostMembersPeopleRequest) -> Result<PostMembersPeopleResponse, String> {
    call(&app, Method::POST, "/members/people", Some(&input)).await
}

#[tauri::command]
pub async fn members_delete(app: AppHandle, member_id: String) -> Result<DeleteMembersMemberIdResponse, String> {
    call(&app, Method::DELETE, &format!("/members/{member_id}"), None::<&()>).await
}

#[tauri::command]
pub async fn members_create_agent(app: AppHandle, input: PostMembersAgentsRequest) -> Result<PostMembersAgentsResponse, String> {
    call(&app, Method::POST, "/members/agents", Some(&input)).await
}

#[tauri::command]
pub async fn members_update_agent(
    app: AppHandle,
    member_id: String,
    patch: PatchMembersAgentsMemberIdRequest,
) -> Result<PatchMembersAgentsMemberIdResponse, String> {
    call(&app, Method::PATCH, &format!("/members/agents/{member_id}"), Some(&patch)).await
}
