//! Local engine process helpers for Host mode.
//!
//! Production prefers the bundled `neos-engine` sidecar. Dev (`tauri dev`) ships a
//! placeholder sidecar, so we fall back to spawning `@neos-work/server` with Node
//! the same way `neos daemon start` does.

use std::path::{Path, PathBuf};

use tauri::async_runtime::Receiver;
use tauri::AppHandle;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Desktop Host mode default listen port (must match JS `DEFAULT_HOST_URL`).
pub const DEFAULT_ENGINE_PORT: u16 = 57286;

pub const PLACEHOLDER_STDOUT: &str = "neos-engine placeholder";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerEntry {
    pub path: PathBuf,
    pub is_typescript: bool,
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct EngineMeta {
    pub port: Option<u16>,
    pub token: Option<String>,
}

pub fn is_engine_placeholder_line(line: &str) -> bool {
    line.trim() == PLACEHOLDER_STDOUT
}

/// Parse `NEOS_PORT=` / `NEOS_AUTH_TOKEN=` lines from engine stdout.
pub fn parse_engine_meta_line(line: &str) -> EngineMeta {
    let trimmed = line.trim();
    if let Some(port_str) = trimmed.strip_prefix("NEOS_PORT=") {
        let n: u16 = match port_str.trim().parse() {
            Ok(n) if n > 0 => n,
            _ => return EngineMeta::default(),
        };
        return EngineMeta {
            port: Some(n),
            token: None,
        };
    }
    if let Some(token) = trimmed.strip_prefix("NEOS_AUTH_TOKEN=") {
        let token = token.trim();
        if token.is_empty()
            || token.len() > 8_192
            || token.bytes().any(|b| b == 0 || b == b'\n' || b == b'\r')
        {
            return EngineMeta::default();
        }
        // Env-provided tokens are logged as this sentinel — not a usable secret.
        if token.starts_with("(from env") {
            return EngineMeta::default();
        }
        return EngineMeta {
            port: None,
            token: Some(token.to_string()),
        };
    }
    EngineMeta::default()
}

pub fn apply_host_env(
    cmd: tauri_plugin_shell::process::Command,
) -> tauri_plugin_shell::process::Command {
    cmd.env("NEOS_PORT", DEFAULT_ENGINE_PORT.to_string())
        .env("PORT", DEFAULT_ENGINE_PORT.to_string())
        .env("NEOS_HOST", "127.0.0.1")
}

pub fn spawn_sidecar_engine(
    app: &AppHandle,
) -> Result<(Receiver<CommandEvent>, CommandChild), String> {
    let cmd = app
        .shell()
        .sidecar("neos-engine")
        .map_err(|e| e.to_string())?;
    apply_host_env(cmd)
        .spawn()
        .map_err(|e| format!("Failed to spawn engine sidecar: {e}"))
}

pub fn spawn_node_engine(
    app: &AppHandle,
    entry: &ServerEntry,
) -> Result<(Receiver<CommandEvent>, CommandChild), String> {
    let node = std::env::var("NEOS_NODE")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && !s.bytes().any(|b| b == 0 || b == b'\n' || b == b'\r'))
        .unwrap_or_else(|| "node".to_string());

    let mut args: Vec<String> = Vec::new();
    if entry.is_typescript {
        args.push("--import".into());
        args.push("tsx".into());
    }
    args.push(entry.path.to_string_lossy().into_owned());

    apply_host_env(app.shell().command(node))
        .args(args)
        .current_dir(&entry.cwd)
        .spawn()
        .map_err(|e| format!("Failed to spawn node engine: {e}"))
}

/// Locate `@neos-work/server` dist (preferred) or `src/index.ts` for `tauri dev`.
pub fn resolve_server_entry() -> Option<ServerEntry> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(raw) = std::env::var("NEOS_SERVER_ENTRY") {
        let t = raw.trim();
        if !t.is_empty() && !t.bytes().any(|b| b == 0 || b == b'\n' || b == b'\r') {
            candidates.push(PathBuf::from(t));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.extend(relative_server_candidates(&cwd));
    }
    candidates.extend(relative_server_candidates(Path::new(env!(
        "CARGO_MANIFEST_DIR"
    ))));
    pick_server_entry(&candidates)
}

fn relative_server_candidates(base: &Path) -> Vec<PathBuf> {
    [
        "server/dist/index.js",
        "../server/dist/index.js",
        "../../server/dist/index.js",
        "../../../server/dist/index.js",
        "apps/server/dist/index.js",
        "server/src/index.ts",
        "../server/src/index.ts",
        "../../server/src/index.ts",
        "../../../server/src/index.ts",
        "apps/server/src/index.ts",
    ]
    .into_iter()
    .map(|rel| base.join(rel))
    .collect()
}

pub fn pick_server_entry(candidates: &[PathBuf]) -> Option<ServerEntry> {
    let mut ts_fallback: Option<PathBuf> = None;
    for raw in candidates {
        let Some(path) = usable_server_file(raw) else {
            continue;
        };
        if is_typescript_entry(&path) {
            if ts_fallback.is_none() {
                ts_fallback = Some(path);
            }
            continue;
        }
        return Some(make_server_entry(path, false));
    }
    ts_fallback.map(|path| make_server_entry(path, true))
}

fn usable_server_file(raw: &Path) -> Option<PathBuf> {
    let name = raw.file_name()?.to_str()?;
    if name != "index.js" && name != "index.ts" {
        return None;
    }
    let path = raw.canonicalize().ok()?;
    if path.is_file() {
        Some(path)
    } else {
        None
    }
}

fn is_typescript_entry(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some("ts")
}

fn make_server_entry(path: PathBuf, is_typescript: bool) -> ServerEntry {
    let cwd = server_package_dir(&path);
    ServerEntry {
        path,
        is_typescript,
        cwd,
    }
}

fn server_package_dir(entry: &Path) -> PathBuf {
    match entry
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
    {
        Some("dist") | Some("src") => entry
            .parent()
            .and_then(|p| p.parent())
            .unwrap_or(entry)
            .to_path_buf(),
        _ => entry.parent().unwrap_or(entry).to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

    fn scratch_dir() -> PathBuf {
        let n = TEST_DIR_SEQ.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("neos-engine-entry-{}-{}", std::process::id(), n));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("dist")).unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();
        dir
    }

    #[test]
    fn parse_port_and_token() {
        assert_eq!(
            parse_engine_meta_line("NEOS_PORT=57286"),
            EngineMeta {
                port: Some(57286),
                token: None
            }
        );
        assert_eq!(
            parse_engine_meta_line("NEOS_AUTH_TOKEN=abcdef0123456789"),
            EngineMeta {
                port: None,
                token: Some("abcdef0123456789".into())
            }
        );
        assert_eq!(
            parse_engine_meta_line("NEOS_AUTH_TOKEN=(from env, value not printed)"),
            EngineMeta::default()
        );
        assert_eq!(parse_engine_meta_line("ready"), EngineMeta::default());
        assert_eq!(parse_engine_meta_line("NEOS_PORT=0"), EngineMeta::default());
        assert_eq!(
            parse_engine_meta_line("NEOS_AUTH_TOKEN=bad\ntoken"),
            EngineMeta::default()
        );
    }

    #[test]
    fn placeholder_line_is_exact() {
        assert!(is_engine_placeholder_line("neos-engine placeholder"));
        assert!(is_engine_placeholder_line("  neos-engine placeholder\n"));
        assert!(!is_engine_placeholder_line("engine ready"));
    }

    #[test]
    fn pick_prefers_js_dist_over_ts_src() {
        let dir = scratch_dir();
        let js = dir.join("dist/index.js");
        let ts = dir.join("src/index.ts");
        fs::write(&js, "js").unwrap();
        fs::write(&ts, "ts").unwrap();
        let picked = pick_server_entry(&[js.clone(), ts.clone()]).unwrap();
        assert!(!picked.is_typescript);
        assert_eq!(picked.path, js.canonicalize().unwrap());
        assert_eq!(picked.cwd, dir.canonicalize().unwrap());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn pick_falls_back_to_typescript() {
        let dir = scratch_dir();
        let ts = dir.join("src/index.ts");
        fs::write(&ts, "ts").unwrap();
        let picked = pick_server_entry(&[dir.join("dist/index.js"), ts.clone()]).unwrap();
        assert!(picked.is_typescript);
        assert_eq!(picked.path, ts.canonicalize().unwrap());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn pick_rejects_non_index_files() {
        let dir = scratch_dir();
        let other = dir.join("dist/other.js");
        fs::write(&other, "no").unwrap();
        assert!(pick_server_entry(&[other]).is_none());
        let _ = fs::remove_dir_all(dir);
    }
}
