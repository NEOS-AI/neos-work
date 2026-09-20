/// NEOS Work desktop application.
/// Uses Tauri v2 as the desktop shell with a React frontend.
mod commands;
mod models;
mod services;
mod utils;

#[cfg(test)]
mod smoke;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

use commands::license::LicenseState;
use services::engine::{
    is_engine_placeholder_line, parse_engine_meta_line, resolve_server_entry, spawn_node_engine,
    spawn_sidecar_engine, EngineMeta,
};
use services::job::JobRegistry;

struct EngineState {
    child: Mutex<Option<CommandChild>>,
    auth_token: Mutex<Option<String>>,
    port: Mutex<Option<u16>>,
    alive: AtomicBool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EngineWatch {
    Pending,
    Ready,
    Dead,
}

fn engine_is_live(state: &EngineState) -> bool {
    state.alive.load(Ordering::SeqCst) && state.child.lock().map(|g| g.is_some()).unwrap_or(false)
}

fn clear_engine_meta(state: &EngineState) {
    if let Ok(mut token) = state.auth_token.lock() {
        *token = None;
    }
    if let Ok(mut port) = state.port.lock() {
        *port = None;
    }
}

fn kill_stored_child(state: &EngineState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
    state.alive.store(false, Ordering::SeqCst);
    clear_engine_meta(state);
}

fn store_child(state: &EngineState, child: CommandChild) -> Result<u32, String> {
    let pid = child.pid();
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    *guard = Some(child);
    state.alive.store(true, Ordering::SeqCst);
    Ok(pid)
}

fn apply_engine_meta(app: &tauri::AppHandle, meta: EngineMeta) {
    if let Some(token) = meta.token {
        if let Ok(mut guard) = app.state::<EngineState>().auth_token.lock() {
            *guard = Some(token);
        }
    }
    if let Some(port) = meta.port {
        if let Ok(mut guard) = app.state::<EngineState>().port.lock() {
            *guard = Some(port);
        }
    }
}

fn attach_engine_reader(
    app: tauri::AppHandle,
    mut rx: tauri::async_runtime::Receiver<CommandEvent>,
    expected_pid: u32,
    watch_tx: tokio::sync::watch::Sender<EngineWatch>,
) {
    tauri::async_runtime::spawn(async move {
        let mut got_port = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let trimmed = text.trim();
                    if is_engine_placeholder_line(trimmed) {
                        let _ = watch_tx.send(EngineWatch::Dead);
                    }
                    let meta = parse_engine_meta_line(trimmed);
                    if meta.port.is_some() {
                        got_port = true;
                    }
                    apply_engine_meta(&app, meta);
                    if got_port {
                        let _ = watch_tx.send(EngineWatch::Ready);
                    }
                    println!("[engine] {}", trimmed);
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[engine] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    println!("[engine] terminated with code: {:?}", payload.code);
                    let state = app.state::<EngineState>();
                    if let Ok(mut guard) = state.child.lock() {
                        if guard.as_ref().map(|c| c.pid()) == Some(expected_pid) {
                            *guard = None;
                            state.alive.store(false, Ordering::SeqCst);
                            clear_engine_meta(&state);
                        }
                    }
                    if !got_port {
                        let _ = watch_tx.send(EngineWatch::Dead);
                    }
                    break;
                }
                _ => {}
            }
        }
    });
}

async fn await_engine_watch(
    mut rx: tokio::sync::watch::Receiver<EngineWatch>,
    timeout: Duration,
) -> EngineWatch {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match *rx.borrow() {
            EngineWatch::Ready => return EngineWatch::Ready,
            EngineWatch::Dead => return EngineWatch::Dead,
            EngineWatch::Pending => {}
        }
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return *rx.borrow();
        }
        match tokio::time::timeout(remaining, rx.changed()).await {
            Ok(Ok(())) => {}
            Ok(Err(_)) | Err(_) => return *rx.borrow(),
        }
    }
}

async fn spawn_and_watch(
    app: &tauri::AppHandle,
    state: &EngineState,
    rx: tauri::async_runtime::Receiver<CommandEvent>,
    child: CommandChild,
    timeout: Duration,
) -> Result<EngineWatch, String> {
    let pid = store_child(state, child)?;
    let (watch_tx, watch_rx) = tokio::sync::watch::channel(EngineWatch::Pending);
    attach_engine_reader(app.clone(), rx, pid, watch_tx);
    Ok(await_engine_watch(watch_rx, timeout).await)
}

/// Start the local engine: bundled sidecar first, then Node `@neos-work/server`.
/// Parses NEOS_PORT and NEOS_AUTH_TOKEN from stdout.
/// Returns "ok" / "already_running", or an error string.
#[tauri::command]
async fn start_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, EngineState>,
) -> Result<String, String> {
    if engine_is_live(&state) {
        return Ok("already_running".into());
    }
    kill_stored_child(&state);

    match spawn_sidecar_engine(&app) {
        Ok((rx, child)) => {
            match spawn_and_watch(&app, &state, rx, child, Duration::from_millis(1_500)).await? {
                EngineWatch::Ready | EngineWatch::Pending => return Ok("ok".into()),
                EngineWatch::Dead => {
                    eprintln!("[engine] sidecar exited without NEOS_PORT; trying node fallback");
                    kill_stored_child(&state);
                }
            }
        }
        Err(e) => {
            eprintln!("[engine] sidecar spawn failed ({e}); trying node fallback");
        }
    }

    let entry = resolve_server_entry().ok_or_else(|| {
        "Engine sidecar is not a live server and @neos-work/server was not found. Build the server or set NEOS_SERVER_ENTRY.".to_string()
    })?;
    eprintln!(
        "[engine] spawning node {} (ts={})",
        entry.path.display(),
        entry.is_typescript
    );
    let (rx, child) = spawn_node_engine(&app, &entry)?;
    match spawn_and_watch(&app, &state, rx, child, Duration::from_secs(8)).await? {
        EngineWatch::Ready | EngineWatch::Pending => Ok("ok".into()),
        EngineWatch::Dead => {
            kill_stored_child(&state);
            Err("Failed to start local engine".into())
        }
    }
}

/// Stop the engine server process if this app started it.
#[tauri::command]
async fn stop_engine(state: tauri::State<'_, EngineState>) -> Result<(), String> {
    kill_stored_child(&state);
    Ok(())
}

/// Get the auth token parsed from engine stdout.
#[tauri::command]
async fn get_auth_token(state: tauri::State<'_, EngineState>) -> Result<Option<String>, String> {
    let guard = state.auth_token.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/// Get the engine port parsed from engine stdout.
#[tauri::command]
async fn get_engine_port(state: tauri::State<'_, EngineState>) -> Result<Option<u16>, String> {
    let guard = state.port.lock().map_err(|e| e.to_string())?;
    Ok(*guard)
}

const KEYRING_SERVICE: &str = "neos-work";
const KEYRING_ACCOUNT: &str = "master-key";

/// Read AES master key (base64 of 32 raw bytes) from the OS keyring.
/// Returns `None` when no entry exists.
#[tauri::command]
fn get_master_key() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("keyring entry: {e}"))?;
    match entry.get_password() {
        Ok(pw) => {
            let t = pw.trim().to_string();
            if t.is_empty() {
                Ok(None)
            } else {
                Ok(Some(t))
            }
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("keyring get: {e}")),
    }
}

/// Store AES master key (base64 of 32 raw bytes) in the OS keyring.
#[tauri::command]
fn set_master_key(key_b64: String) -> Result<(), String> {
    if key_b64.chars().any(|c| c == '\0' || c == '\n' || c == '\r') {
        return Err("invalid key material".into());
    }
    let t = key_b64.trim();
    if t.is_empty() || t.len() > 128 {
        return Err("invalid key material length".into());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("keyring entry: {e}"))?;
    entry
        .set_password(t)
        .map_err(|e| format!("keyring set: {e}"))
}

/// Delete AES master key from the OS keyring (no-op if missing).
#[tauri::command]
fn delete_master_key() -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|e| format!("keyring entry: {e}"))?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("keyring delete: {e}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(EngineState {
            child: Mutex::new(None),
            auth_token: Mutex::new(None),
            port: Mutex::new(None),
            alive: AtomicBool::new(false),
        })
        .manage(JobRegistry::default())
        .manage(LicenseState::default())
        .invoke_handler(tauri::generate_handler![
            start_engine,
            stop_engine,
            get_auth_token,
            get_engine_port,
            get_master_key,
            set_master_key,
            delete_master_key,
            commands::probe::analyze_video,
            commands::probe::check_environment,
            commands::audio::extract_audio,
            commands::audio::extract_subtitle,
            commands::transcode::transcode_video,
            commands::transcode::mux_video,
            commands::resize::resize_video,
            commands::trim::trim_video,
            commands::concat::concat_videos,
            commands::transform::transform_video,
            commands::frame::export_frame,
            commands::reveal::reveal_path,
            commands::crop::crop_video,
            commands::gif::export_gif,
            commands::speed::change_speed,
            commands::volume::adjust_volume,
            commands::watermark::apply_watermark,
            commands::fade::fade_video,
            commands::job::cancel_job,
            commands::license::set_license_file,
            commands::license::license_status,
            commands::timeline::validate_timeline,
            commands::timeline::export_timeline,
            commands::timeline::render_timeline_proxy,
            commands::timeline::read_text_file,
            commands::timeline::write_text_file,
            commands::timeline::remove_file,
            commands::download::probe_download,
            commands::download::probe_download_list,
            commands::download::classify_download_url,
            commands::download::parse_download_lines,
            commands::download::download_video,
        ])
        .on_window_event(|window, event| {
            // Stop only the engine this app started (reused daemons are left running)
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<EngineState>();
                kill_stored_child(&state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running NEOS Work");
}
