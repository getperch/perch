use reqwest::Method;
use tauri::AppHandle;

use super::client::call;
use super::types::*;

#[tauri::command]
pub async fn messages_list(
    app: AppHandle,
    channel_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<GetChannelsChannelIdMessagesResponse, String> {
    let mut path = format!("/channels/{channel_id}/messages");
    let mut query = vec![];
    if let Some(cursor) = &cursor {
        query.push(format!("cursor={cursor}"));
    }
    if let Some(limit) = limit {
        query.push(format!("limit={limit}"));
    }
    if !query.is_empty() {
        path.push('?');
        path.push_str(&query.join("&"));
    }
    call(&app, Method::GET, &path, None::<&()>).await
}

#[tauri::command]
pub async fn messages_send(
    app: AppHandle,
    channel_id: String,
    input: PostChannelsChannelIdMessagesRequest,
) -> Result<PostChannelsChannelIdMessagesResponse, String> {
    call(&app, Method::POST, &format!("/channels/{channel_id}/messages"), Some(&input)).await
}

#[tauri::command]
pub async fn messages_toggle_reaction(
    app: AppHandle,
    channel_id: String,
    message_id: String,
    input: PostChannelsChannelIdMessagesMessageIdReactionsRequest,
) -> Result<PostChannelsChannelIdMessagesMessageIdReactionsResponse, String> {
    call(&app, Method::POST, &format!("/channels/{channel_id}/messages/{message_id}/reactions"), Some(&input)).await
}

#[tauri::command]
pub async fn messages_edit(
    app: AppHandle,
    channel_id: String,
    message_id: String,
    input: PatchChannelsChannelIdMessagesMessageIdRequest,
) -> Result<PatchChannelsChannelIdMessagesMessageIdResponse, String> {
    call(&app, Method::PATCH, &format!("/channels/{channel_id}/messages/{message_id}"), Some(&input)).await
}

#[tauri::command]
pub async fn messages_delete(
    app: AppHandle,
    channel_id: String,
    message_id: String,
) -> Result<DeleteChannelsChannelIdMessagesMessageIdResponse, String> {
    call(&app, Method::DELETE, &format!("/channels/{channel_id}/messages/{message_id}"), None::<&()>).await
}
