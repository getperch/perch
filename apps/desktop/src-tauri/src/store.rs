use serde::Deserialize;
use serde_json::json;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

/// Same file/key shape `apps/desktop/src/lib/auth-token-store.ts` already reads/writes from the JS
/// side (`{ access, refresh }` under the `"session"` key in `auth.json`) — both sides go through
/// the same `tauri-plugin-store`-managed file, so whichever side wrote last is what the other reads.
#[derive(Deserialize)]
struct StoredSession {
    access: String,
    refresh: String,
}

/// Same shape `apps/desktop/src/lib/backend-config-store.ts` writes (`{ apiUrl }` under the
/// `"backendConfig"` key in `backend-config.json`).
#[derive(Deserialize)]
struct StoredBackendConfig {
    #[serde(rename = "apiUrl")]
    api_url: String,
}

pub fn access_token(app: &AppHandle) -> Option<String> {
    let store = app.store("auth.json").ok()?;
    let value = store.get("session")?;
    serde_json::from_value::<StoredSession>(value).ok().map(|s| s.access)
}

pub fn refresh_token(app: &AppHandle) -> Option<String> {
    let store = app.store("auth.json").ok()?;
    let value = store.get("session")?;
    serde_json::from_value::<StoredSession>(value).ok().map(|s| s.refresh)
}

pub fn api_url(app: &AppHandle) -> Option<String> {
    let store = app.store("backend-config.json").ok()?;
    let value = store.get("backendConfig")?;
    serde_json::from_value::<StoredBackendConfig>(value).ok().map(|c| c.api_url)
}

/// Written only by `auth::complete_sign_in` on a successful PKCE token exchange.
pub fn save_session(app: &AppHandle, access: &str, refresh: &str) -> Result<(), String> {
    let store = app.store("auth.json").map_err(|e| e.to_string())?;
    store.set("session", json!({ "access": access, "refresh": refresh }));
    store.save().map_err(|e| e.to_string())
}

/// Mirrors `api/client.rs`'s 401/403-clears-the-session behavior and the JS-side `signOut()`'s
/// `clearSession()` — same file, same key, either side can clear it.
pub fn clear_session(app: &AppHandle) -> Result<(), String> {
    let store = app.store("auth.json").map_err(|e| e.to_string())?;
    store.delete("session");
    store.save().map_err(|e| e.to_string())
}
