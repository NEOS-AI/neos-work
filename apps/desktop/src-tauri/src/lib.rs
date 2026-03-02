/// NEOS Work desktop application.
/// Uses Tauri v2 as the desktop shell with a React frontend.

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

struct EngineState {
    child: Mutex<Option<CommandChild>>,
    auth_token: Mutex<Option<String>>,
    port: Mutex<Option<u16>>,
}

/// Attempt to start the engine server as a sidecar process.
/// Parses NEOS_PORT and NEOS_AUTH_TOKEN from sidecar stdout.
/// Returns "ok" on success, or an error string if the sidecar binary is not available.
#[tauri::command]
async fn start_engine(app: tauri::AppHandle, state: tauri::State<'_, EngineState>) -> Result<String, String> {
    // Don't start if already running
    {
        let guard = state.child.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok("already_running".into());
        }
    }

    // Try to spawn the sidecar binary (available in production builds)
    let sidecar = app.shell().sidecar("neos-engine").map_err(|e| e.to_string())?;

    let (mut rx, child) = sidecar.spawn().map_err(|e| format!("Failed to spawn engine: {}", e))?;

    // Store child handle for later cleanup
    {
        let mut guard = state.child.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
    }

    // Clone state handles for the async task
    let auth_token_state = app.state::<EngineState>();
    let auth_token_mutex = auth_token_state.auth_token.lock().map_err(|e| e.to_string())?;
    drop(auth_token_mutex); // Release immediately, we'll lock again inside the task

    let app_handle = app.clone();

    // Spawn a task to log sidecar output and parse metadata lines
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    let trimmed = text.trim();

                    // Parse structured metadata from engine stdout
                    if let Some(token) = trimmed.strip_prefix("NEOS_AUTH_TOKEN=") {
                        if let Ok(mut guard) = app_handle.state::<EngineState>().auth_token.lock() {
                            *guard = Some(token.to_string());
                        }
                    } else if let Some(port_str) = trimmed.strip_prefix("NEOS_PORT=") {
                        if let Ok(port) = port_str.parse::<u16>() {
                            if let Ok(mut guard) = app_handle.state::<EngineState>().port.lock() {
                                *guard = Some(port);
                            }
                        }
                    }

                    println!("[engine] {}", trimmed);
                }
                CommandEvent::Stderr(line) => {
                    eprintln!("[engine] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(payload) => {
                    println!("[engine] terminated with code: {:?}", payload.code);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok("ok".into())
}

/// Stop the engine server process if running.
#[tauri::command]
async fn stop_engine(state: tauri::State<'_, EngineState>) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        child.kill().map_err(|e| format!("Failed to kill engine: {}", e))?;
    }
    // Clear stored metadata
    if let Ok(mut token) = state.auth_token.lock() {
        *token = None;
    }
    if let Ok(mut port) = state.port.lock() {
        *port = None;
    }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(EngineState {
            child: Mutex::new(None),
            auth_token: Mutex::new(None),
            port: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![start_engine, stop_engine, get_auth_token, get_engine_port])
        .on_window_event(|window, event| {
            // Stop engine when window is destroyed (app close)
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.app_handle().state::<EngineState>();
                if let Ok(mut guard) = state.child.lock() {
                    if let Some(child) = guard.take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running NEOS Work");
}
