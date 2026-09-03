use std::time::Duration;

mod api;
mod auth;
mod google_workspace;
mod sidecar;
mod store;
mod stream;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Without an explicit timeout, reqwest will happily hang forever on a stalled DNS lookup or
    // connection attempt — every command in api/*.rs and auth.rs shares this client, so a single
    // slow/dead network path silently hangs whatever `invoke()` call triggered it (and, since
    // React Query catches queryFn rejections internally rather than letting them become unhandled
    // promise rejections, a *failed* call after this fix still won't show a console error — only
    // a hang shows as nothing happening at all, forever, with zero diagnostics). 30s comfortably
    // covers stream.rs's ~25s SSE polling window (see channel-events.ts) while still failing
    // regular CRUD calls in bounded time instead of never.
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("failed to build reqwest client");

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(http_client)
        .manage(auth::PendingVerifier::default())
        .manage(stream::Subscriptions::default())
        .manage(sidecar::RecordingChild::default())
        .invoke_handler(tauri::generate_handler![
            auth::begin_sign_in,
            auth::complete_sign_in,
            google_workspace::begin_google_connect,
            google_workspace::disconnect_google_workspace,
            api::connectors::google_workspace_get_connection,
            api::connectors::connector_list,
            api::connectors::connector_save_config,
            api::connectors::connector_clear_config,
            sidecar::list_browsers,
            sidecar::procedure_replay_local,
            sidecar::procedure_record_local,
            sidecar::procedure_record_stop,
            sidecar::procedure_resume,
            api::channels::channels_list,
            api::channels::channels_get,
            api::channels::channels_create,
            api::channels::channels_get_or_create_direct,
            api::channels::channels_add_member,
            api::channels::channels_remove_member,
            api::channels::channels_update,
            api::channels::channels_delete,
            api::messages::messages_list,
            api::messages::messages_send,
            api::messages::messages_toggle_reaction,
            api::messages::messages_edit,
            api::messages::messages_delete,
            api::members::members_me,
            api::members::members_list,
            api::members::members_create_person,
            api::members::members_create_agent,
            api::members::members_update_agent,
            api::members::members_delete,
            api::mentions::mentions_list,
            api::models::models_list,
            api::tasks::tasks_list,
            api::tasks::tasks_create,
            api::tasks::tasks_update,
            api::approvals::approvals_resolve,
            api::artifacts::artifacts_get_content,
            api::runs::runs_get,
            api::workspace::workspace_get,
            api::workspace::workspace_update_spend_cap,
            api::workspace::workspace_get_spend,
            api::workspace::workspace_update_settings,
            api::plugins::plugins_list,
            api::plugins::plugins_get,
            api::plugins::plugins_publish,
            api::plugins::plugins_import,
            api::knowledge::knowledge_list,
            api::knowledge::knowledge_get,
            api::knowledge::knowledge_put,
            api::knowledge::knowledge_deprecate,
            api::knowledge::knowledge_verify,
            api::knowledge::knowledge_reindex,
            api::procedures::procedures_list,
            api::procedures::procedures_get,
            api::procedures::procedures_create,
            api::procedures::procedures_update,
            api::procedures::procedures_delete,
            api::procedures::procedures_secret_put,
            api::procedures::procedures_secret_delete,
            api::procedures::procedures_run,
            stream::subscribe_channel_events,
            stream::unsubscribe_channel_events,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Perch");
}
