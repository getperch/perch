use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn channels_list(app: AppHandle) -> Result<Vec<GetChannelsResponseItem>, String> {
    call(&app, Method::GET, "/channels", None::<&()>).await
}

#[tauri::command]
pub async fn channels_get(app: AppHandle, channel_id: String) -> Result<GetChannelsChannelIdResponse, String> {
    call(&app, Method::GET, &format!("/channels/{channel_id}"), None::<&()>).await
}

#[tauri::command]
pub async fn channels_create(app: AppHandle, input: PostChannelsRequest) -> Result<PostChannelsResponse, String> {
    call(&app, Method::POST, "/channels", Some(&input)).await
}

#[tauri::command]
pub async fn channels_get_or_create_direct(app: AppHandle, input: PostChannelsDirectRequest) -> Result<PostChannelsDirectResponse, String> {
    call(&app, Method::POST, "/channels/direct", Some(&input)).await
}

#[tauri::command]
pub async fn channels_add_member(
    app: AppHandle,
    channel_id: String,
    input: PostChannelsChannelIdMembersRequest,
) -> Result<PostChannelsChannelIdMembersResponse, String> {
    call(&app, Method::POST, &format!("/channels/{channel_id}/members"), Some(&input)).await
}

#[tauri::command]
pub async fn channels_remove_member(
    app: AppHandle,
    channel_id: String,
    member_id: String,
) -> Result<DeleteChannelsChannelIdMembersMemberIdResponse, String> {
    call(&app, Method::DELETE, &format!("/channels/{channel_id}/members/{member_id}"), None::<&()>).await
}

#[tauri::command]
pub async fn channels_update(
    app: AppHandle,
    channel_id: String,
    input: PatchChannelsChannelIdRequest,
) -> Result<PatchChannelsChannelIdResponse, String> {
    call(&app, Method::PATCH, &format!("/channels/{channel_id}"), Some(&input)).await
}

#[tauri::command]
pub async fn channels_delete(app: AppHandle, channel_id: String) -> Result<DeleteChannelsChannelIdResponse, String> {
    call(&app, Method::DELETE, &format!("/channels/{channel_id}"), None::<&()>).await
}
