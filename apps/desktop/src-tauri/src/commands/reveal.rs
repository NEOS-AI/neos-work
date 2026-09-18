use std::path::Path;

use crate::models::error::AppError;

/// Open the file's folder in the OS file manager and select it when possible.
#[tauri::command(rename_all = "snake_case")]
pub async fn reveal_path(path: String) -> Result<(), AppError> {
    if path.is_empty() {
        return Err(AppError::InvalidArgument("path must not be empty".into()));
    }
    let p = Path::new(&path);
    if !p.exists() {
        return Err(AppError::FileNotFound(path));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| AppError::Io(e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| AppError::Io(e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let dir = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| AppError::Io(e))?;
    }

    Ok(())
}
