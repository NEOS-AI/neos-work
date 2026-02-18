/// NEOS Work desktop application.
/// Uses Tauri v2 as the desktop shell with a React frontend.

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

struct EngineState {
    child: Mutex<Option<CommandChild>>,
}

/// Attempt to start the engine server as a sidecar process.
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

    // Spawn a task to log sidecar output
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    println!("[engine] {}", String::from_utf8_lossy(&line));
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
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(EngineState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![start_engine, stop_engine])
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
