use std::{collections::HashMap, sync::Mutex, time::Duration};

use tauri::{async_runtime::JoinHandle, ipc::Channel, AppHandle};

use crate::api::client;
use crate::api::types::GetChannelsChannelIdEventsResponse;
use crate::store;

#[derive(Default)]
pub struct Subscriptions(Mutex<HashMap<String, JoinHandle<()>>>);

/// Starts a background loop polling `GET /api/channels/{id}/events` (see
/// `services/api/src/routers/channel-events.ts` — each request is a bounded ~25s window, not a
/// truly indefinite connection; see that file's comment for why). Each window's response is parsed
/// into individual SSE frames and pushed to `on_event`; the loop reconnects immediately using the
/// last frame's `id:` as `Last-Event-ID`, so from the frontend's perspective delivery still looks
/// continuous. Returns a subscription id immediately — the loop runs in the background.
///
/// Uses `tauri::async_runtime::spawn`, not bare `tokio::spawn` — the latter needs the *calling*
/// thread to already be inside an entered Tokio runtime (via thread-local `Handle::current()`),
/// which Tauri doesn't guarantee for the thread a sync `#[tauri::command]` runs on; `tauri::
/// async_runtime::spawn` goes through Tauri's own global runtime handle instead, so it works
/// regardless of which thread calls it. Calling bare `tokio::spawn` from a thread with no entered
/// runtime panics ("there is no reactor running") — check the `tauri dev` terminal (not the webview
/// console) if this ever regresses; a panicked command thread never sends its IPC response back, so
/// the frontend's `invoke("subscribe_channel_events", ...)` call just hangs forever instead of
/// rejecting, which is consistent with a permanently-blank screen (the channel query this feeds
/// never resolves) rather than a visible error.
#[tauri::command]
pub fn subscribe_channel_events(
    app: AppHandle,
    subscriptions: tauri::State<Subscriptions>,
    channel_id: String,
    on_event: Channel<GetChannelsChannelIdEventsResponse>,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let handle = tauri::async_runtime::spawn(run(app, channel_id, on_event));
    subscriptions.0.lock().unwrap().insert(id.clone(), handle);
    Ok(id)
}

#[tauri::command]
pub fn unsubscribe_channel_events(subscriptions: tauri::State<Subscriptions>, id: String) {
    if let Some(handle) = subscriptions.0.lock().unwrap().remove(&id) {
        handle.abort();
    }
}

async fn run(app: AppHandle, channel_id: String, on_event: Channel<GetChannelsChannelIdEventsResponse>) {
    eprintln!("channel event stream[{channel_id}]: starting");
    let mut cursor = String::new();
    loop {
        match poll_once(&app, &channel_id, &cursor, &on_event).await {
            Ok(next_cursor) => {
                if let Some(next_cursor) = next_cursor {
                    eprintln!("channel event stream[{channel_id}]: cursor advanced to {next_cursor}");
                    cursor = next_cursor;
                }
            }
            Err(err) => {
                eprintln!("channel event stream[{channel_id}]: poll failed, retrying in 1.5s: {err}");
                tokio::time::sleep(Duration::from_millis(1500)).await;
            }
        }
    }
}

/// One bounded-window request; returns the last event's cursor seen, if any.
///
/// Goes through `api::client::send_authenticated` (the same helper every `api/*.rs` command
/// uses) rather than a hand-rolled bearer-auth request — this used to send its own raw request
/// with whatever token was in the store, so an expired access token during a long-lived SSE
/// subscription never triggered the transparent refresh-and-retry the rest of the app gets, just
/// an infinite loop of 401s that a fresh sign-in elsewhere couldn't visibly recover until the app
/// restarted. `send_authenticated` returning `Err("signed out")` here (refresh failed, or the
/// retried request was still 401/403) is treated the same as any other failure below — the loop
/// just keeps retrying every 1.5s, same as before; once the session is cleared, the frontend's own
/// `useAuth()` observes that and routes back to sign-in independently of this loop.
async fn poll_once(
    app: &AppHandle,
    channel_id: &str,
    cursor: &str,
    on_event: &Channel<GetChannelsChannelIdEventsResponse>,
) -> Result<Option<String>, String> {
    let api_url = store::api_url(app).ok_or("backend not configured")?;
    let url = format!("{api_url}/api/channels/{channel_id}/events");
    let headers: &[(&str, &str)] = if cursor.is_empty() { &[] } else { &[("Last-Event-ID", cursor)] };

    let res = client::send_authenticated::<()>(app, reqwest::Method::GET, &url, None, headers)
        .await
        .map_err(|e| {
            eprintln!("channel event stream[{channel_id}]: request failed: {e}");
            e
        })?;

    let status = res.status();
    let body = res.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        eprintln!(
            "channel event stream[{channel_id}]: non-success status {status}, body: {body}"
        );
        return Err(format!("status {status}"));
    }

    eprintln!(
        "channel event stream[{channel_id}]: status {status}, {} bytes",
        body.len()
    );

    let mut last_cursor = None;
    let mut frame_count = 0;
    for frame in body.split("\n\n") {
        let mut frame_id = None;
        let mut frame_data = None;
        for line in frame.lines() {
            if let Some(rest) = line.strip_prefix("id: ") {
                frame_id = Some(rest.to_string());
            } else if let Some(rest) = line.strip_prefix("data: ") {
                frame_data = Some(rest.to_string());
            }
        }
        if let Some(data) = frame_data {
            frame_count += 1;
            match serde_json::from_str::<GetChannelsChannelIdEventsResponse>(&data) {
                Ok(event) => {
                    if let Err(err) = on_event.send(event) {
                        eprintln!("channel event stream[{channel_id}]: on_event.send failed (webview channel closed?): {err}");
                    }
                }
                // The cursor still advances past this frame below (retrying it forever would wedge
                // the whole stream on one bad frame), so a parse failure here means this event is
                // gone for good — log it loudly rather than losing it in silence.
                Err(err) => eprintln!("channel event stream[{channel_id}]: failed to parse frame, skipping: {err}\n  data: {data}"),
            }
        }
        if frame_id.is_some() {
            last_cursor = frame_id;
        }
    }

    eprintln!("channel event stream[{channel_id}]: parsed {frame_count} event frame(s), cursor: {last_cursor:?}");

    if frame_count == 0 && !body.is_empty() {
        let preview: String = body.chars().take(500).collect();
        eprintln!(
            "channel event stream[{channel_id}]: 0 frames from a non-empty body ({} bytes) — first 500 chars:\n{preview:?}",
            body.len()
        );
    }

    Ok(last_cursor)
}
