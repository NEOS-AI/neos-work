use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri::async_runtime::Receiver;

use crate::models::error::AppError;
use crate::utils::binary::{
    sidecar_filename, system_ffmpeg_name, system_ffprobe_name, system_ytdlp_name, FFMPEG_SIDECAR,
    FFPROBE_SIDECAR, YTDLP_SIDECAR,
};

pub struct SpawnedSidecar {
    pub rx: Receiver<CommandEvent>,
    pub child: CommandChild,
    pub source: String,
}

/// Try the bundled sidecar first, then fall back to a system binary on PATH.
/// This is how Windows/Linux machines without a bundled triple-named binary still work.
pub fn spawn_ffmpeg(app: &AppHandle, args: &[String]) -> Result<SpawnedSidecar, AppError> {
    spawn_tool(
        app,
        FFMPEG_SIDECAR,
        system_ffmpeg_name(),
        args,
        "FFmpeg",
    )
}

fn spawn_tool(
    app: &AppHandle,
    sidecar: &str,
    system_name: &str,
    args: &[String],
    label: &str,
) -> Result<SpawnedSidecar, AppError> {
    match app.shell().sidecar(sidecar) {
        Ok(cmd) => match cmd.args(args).spawn() {
            Ok((rx, child)) => {
                return Ok(SpawnedSidecar {
                    rx,
                    child,
                    source: format!("sidecar:{sidecar}"),
                });
            }
            Err(e) => {
                eprintln!("{label} sidecar spawn failed ({e}); trying system PATH");
            }
        },
        Err(e) => {
            eprintln!("{label} sidecar unavailable ({e}); trying system PATH");
        }
    }

    let (rx, child) = app
        .shell()
        .command(system_name)
        .args(args)
        .spawn()
        .map_err(|e| {
            AppError::Sidecar(format!(
                "{label} sidecar and system `{system_name}` both failed: {e}"
            ))
        })?;

    Ok(SpawnedSidecar {
        rx,
        child,
        source: format!("path:{system_name}"),
    })
}

/// Run a short-lived tool and capture stdout+stderr. Tries sidecar then PATH.
pub async fn output_ffmpeg(app: &AppHandle, args: &[&str]) -> Result<(bool, String, String), AppError> {
    output_tool(app, FFMPEG_SIDECAR, system_ffmpeg_name(), args, "FFmpeg").await
}

pub async fn output_ffprobe(
    app: &AppHandle,
    args: &[&str],
) -> Result<(bool, String, String), AppError> {
    output_tool(app, FFPROBE_SIDECAR, system_ffprobe_name(), args, "FFprobe").await
}

pub fn spawn_ytdlp(app: &AppHandle, args: &[String]) -> Result<SpawnedSidecar, AppError> {
    if let Some(path) = resolve_optional_tool_path(app, "yt-dlp") {
        match app.shell().command(&path).args(args).spawn() {
            Ok((rx, child)) => {
                return Ok(SpawnedSidecar {
                    rx,
                    child,
                    source: format!("file:{path}"),
                });
            }
            Err(e) => {
                eprintln!("yt-dlp at {path} failed ({e}); trying system PATH");
            }
        }
    }
    spawn_tool(
        app,
        YTDLP_SIDECAR,
        system_ytdlp_name(),
        args,
        "yt-dlp",
    )
}

pub async fn output_ytdlp(
    app: &AppHandle,
    args: &[&str],
) -> Result<(bool, String, String), AppError> {
    if let Some(path) = resolve_optional_tool_path(app, "yt-dlp") {
        match app.shell().command(&path).args(args).output().await {
            Ok(out) => {
                return Ok((
                    out.status.success(),
                    merge_output(&out.stdout, &out.stderr, out.status.success()),
                    format!("file:{path}"),
                ));
            }
            Err(e) => {
                eprintln!("yt-dlp at {path} failed ({e}); trying system PATH");
            }
        }
    }
    output_tool(app, YTDLP_SIDECAR, system_ytdlp_name(), args, "yt-dlp").await
}

/// On-disk optional tool (not in externalBin). Skip empty placeholders.
fn resolve_optional_tool_path(app: &AppHandle, name: &str) -> Option<String> {
    use tauri::Manager;
    let filename = sidecar_filename(name);
    let candidates = {
        let mut v = Vec::new();
        if let Ok(res) = app.path().resource_dir() {
            v.push(res.join(&filename));
            v.push(res.join("binaries").join(&filename));
        }
        v.push(std::path::PathBuf::from("binaries").join(&filename));
        v
    };
    for p in candidates {
        if let Ok(meta) = p.metadata() {
            if meta.is_file() && meta.len() > 0 {
                return p
                    .canonicalize()
                    .ok()
                    .map(|c| c.to_string_lossy().into_owned())
                    .or_else(|| Some(p.to_string_lossy().into_owned()));
            }
        }
    }
    None
}

fn merge_output(stdout: &[u8], stderr: &[u8], success: bool) -> String {
    let stdout = String::from_utf8_lossy(stdout).to_string();
    let stderr = String::from_utf8_lossy(stderr).to_string();
    if success || stderr.trim().is_empty() {
        stdout
    } else if stdout.trim().is_empty() {
        stderr
    } else {
        format!("{stdout}\n{stderr}")
    }
}

/// Path to the ffmpeg binary for `--ffmpeg-location`, if we can see a real file.
pub fn resolve_ffmpeg_location(app: &AppHandle) -> Option<String> {
    use tauri::Manager;
    let name = sidecar_filename("ffmpeg");
    if let Ok(res) = app.path().resource_dir() {
        let candidate = res.join(&name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
        let nested = res.join("binaries").join(&name);
        if nested.is_file() {
            return Some(nested.to_string_lossy().into_owned());
        }
    }
    let dev = std::path::Path::new("binaries").join(&name);
    if dev.is_file() {
        return dev.canonicalize().ok().map(|p| p.to_string_lossy().into_owned());
    }
    None
}

async fn output_tool(
    app: &AppHandle,
    sidecar: &str,
    system_name: &str,
    args: &[&str],
    label: &str,
) -> Result<(bool, String, String), AppError> {
    if let Ok(cmd) = app.shell().sidecar(sidecar) {
        match cmd.args(args).output().await {
            Ok(out) => {
                return Ok((
                    out.status.success(),
                    merge_output(&out.stdout, &out.stderr, out.status.success()),
                    format!("sidecar:{sidecar}"),
                ));
            }
            Err(e) => {
                eprintln!("{label} sidecar output failed ({e}); trying system PATH");
            }
        }
    }

    let out = app
        .shell()
        .command(system_name)
        .args(args)
        .output()
        .await
        .map_err(|e| {
            AppError::Sidecar(format!(
                "{label} sidecar and system `{system_name}` both failed: {e}"
            ))
        })?;
    Ok((
        out.status.success(),
        merge_output(&out.stdout, &out.stderr, out.status.success()),
        format!("path:{system_name}"),
    ))
}
