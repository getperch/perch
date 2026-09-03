use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{
    process::{Command, CommandChild, CommandEvent},
    ShellExt,
};

/// Holds the child process of an in-progress local recording so `procedure_record_stop` can ask it
/// to finish gracefully (it flushes the captured steps on stdin `stop`, unlike a hard kill).
#[derive(Default)]
pub struct RecordingChild(pub Mutex<Option<CommandChild>>);

/// Builds the command that runs the Playwright sidecar. Prefers the self-contained bundled binary
/// (`externalBin` → `perch-sidecar`), which needs nothing installed. Falls back to running the
/// built script through a system `node` (dev builds without the binary). The task JSON arg is
/// appended by the caller.
fn sidecar_command(app: &AppHandle) -> Result<Command, String> {
    let cmd = match app.shell().sidecar("perch-sidecar") {
        Ok(c) => c,
        Err(_) => {
            let script = sidecar_script(app)?;
            app.shell().command("node").arg(script.to_string_lossy().to_string())
        }
    };
    // Persisted browser profile: sign into Google once, keep the session. Lives in the app's data
    // dir so it survives across runs (and isn't the user's real Chrome profile).
    if let Ok(dir) = app.path().app_data_dir() {
        return Ok(cmd.env("PERCH_PROFILE_DIR", dir.join("browser-profile").to_string_lossy().to_string()));
    }
    Ok(cmd)
}

fn sidecar_script(app: &AppHandle) -> Result<PathBuf, String> {
    for rel in ["sidecar/dist/index.cjs", "sidecar/src/index.ts"] {
        if let Ok(p) = app.path().resolve(rel, BaseDirectory::Resource) {
            if p.exists() {
                return Ok(p);
            }
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/dist/index.cjs");
    if dev.exists() {
        return Ok(dev);
    }
    Err("browser helper not built — run `pnpm --filter @perch/desktop-sidecar build`".into())
}

/// Runs one sidecar task, forwarding every NDJSON line as a Tauri event on `event_name`. Returns
/// the terminal object (`result`/`browsers`/`recording`), or an error. When `child_slot` is given,
/// the child process is parked there for its lifetime so another command can signal it.
async fn run_task(
    app: &AppHandle,
    task: serde_json::Value,
    event_name: &str,
    child_slot: Option<&RecordingChild>,
) -> Result<serde_json::Value, String> {
    let (mut rx, child) = sidecar_command(app)?
        .arg(task.to_string())
        .spawn()
        .map_err(|e| format!("couldn't start the browser helper: {e}"))?;

    // Keep the child alive for the duration of the loop — parked in `child_slot` if given (so
    // `procedure_record_stop` can reach it), otherwise in a local binding.
    let mut _keepalive = None;
    match child_slot {
        Some(slot) => *slot.0.lock().unwrap() = Some(child),
        None => _keepalive = Some(child),
    }

    let mut buf = String::new();
    let mut terminal: Option<serde_json::Value> = None;
    let mut err: Option<String> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                buf.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(nl) = buf.find('\n') {
                    let line: String = buf.drain(..=nl).collect();
                    let line = line.trim();
                    if line.is_empty() {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                        let _ = app.emit(event_name, &v);
                        match v.get("t").and_then(|t| t.as_str()) {
                            Some("result") | Some("browsers") | Some("recording") => terminal = Some(v),
                            Some("error") => err = v.get("detail").and_then(|d| d.as_str()).map(str::to_string),
                            _ => {}
                        }
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                let s = String::from_utf8_lossy(&bytes);
                let s = s.trim();
                if !s.is_empty() {
                    let _ = app.emit(event_name, serde_json::json!({ "t": "step", "kind": "note", "detail": s }));
                }
            }
            CommandEvent::Terminated(payload) => {
                if terminal.is_none() && err.is_none() && payload.code != Some(0) {
                    err = Some(format!("browser helper exited (code {:?})", payload.code));
                }
            }
            _ => {}
        }
    }

    if let Some(slot) = child_slot {
        slot.0.lock().unwrap().take();
    }
    if let Some(e) = err {
        return Err(e);
    }
    terminal.ok_or_else(|| "the browser helper finished without a result".into())
}

/// Startup check: which browsers the sidecar can drive. `{ system: ["chrome", …], bundled: bool }`.
#[tauri::command]
pub async fn list_browsers(app: AppHandle) -> Result<serde_json::Value, String> {
    let v = run_task(&app, serde_json::json!({ "task": "probe" }), "sidecar:probe", None).await?;
    Ok(serde_json::json!({
        "system": v.get("system").cloned().unwrap_or(serde_json::json!([])),
        "bundled": v.get("bundled").and_then(|b| b.as_bool()).unwrap_or(false),
    }))
}

/// Replays a list of `ProcedureStep`s in the user's own browser and returns whatever the routine's
/// `extract` steps captured (`{ extracted: { key: value } }`). Streams progress as
/// `procedure:local` events. Used for connector setup and any other local routine.
#[tauri::command]
pub async fn procedure_replay_local(
    app: AppHandle,
    steps: serde_json::Value,
    secrets: Option<serde_json::Value>,
    start_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let task = serde_json::json!({
        "task": "replay",
        "steps": steps,
        "secrets": secrets.unwrap_or(serde_json::json!({})),
        "startUrl": start_url,
    });
    let v = run_task(&app, task, "procedure:local", None).await?;
    Ok(v.get("extracted").cloned().unwrap_or(serde_json::json!({})))
}

/// Records a routine by watching the user drive their own browser. Streams captured steps as
/// `procedure:local` events; resolves with `{ steps: [...], startUrl }` when the window is closed
/// or `procedure_record_stop` is called.
#[tauri::command]
pub async fn procedure_record_local(
    app: AppHandle,
    child: State<'_, RecordingChild>,
    start_url: String,
) -> Result<serde_json::Value, String> {
    let task = serde_json::json!({ "task": "record", "startUrl": start_url });
    let v = run_task(&app, task, "procedure:local", Some(&child)).await?;
    Ok(serde_json::json!({
        "steps": v.get("steps").cloned().unwrap_or(serde_json::json!([])),
        "startUrl": v.get("startUrl").cloned().unwrap_or(serde_json::json!(start_url)),
    }))
}

/// Asks the in-progress recording to finish and flush its captured steps (the sidecar reads
/// `stop` on stdin). No-op if nothing is recording.
#[tauri::command]
pub fn procedure_record_stop(child: State<'_, RecordingChild>) -> Result<(), String> {
    if let Some(c) = child.0.lock().unwrap().as_mut() {
        c.write(b"stop\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}
