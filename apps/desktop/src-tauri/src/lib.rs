/// NEOS Work desktop application.
/// Uses Tauri v2 as the desktop shell with a React frontend.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running NEOS Work");
}
