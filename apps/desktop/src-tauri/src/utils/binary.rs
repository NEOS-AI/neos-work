/// Names used to identify sidecar binaries in tauri.conf.json `externalBin`.
/// Tauri appends the target triple automatically at bundle time.
pub const FFMPEG_SIDECAR: &str = "binaries/ffmpeg";
pub const FFPROBE_SIDECAR: &str = "binaries/ffprobe";
pub const YTDLP_SIDECAR: &str = "binaries/yt-dlp";

/// Rustc target triple for the current compile target.
/// Used to name sidecars (`ffmpeg-<triple>[.exe]`) and report environment info.
pub fn current_target_triple() -> &'static str {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        "aarch64-apple-darwin"
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        "x86_64-apple-darwin"
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        "aarch64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        "x86_64-unknown-linux-gnu"
    }
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        "aarch64-pc-windows-msvc"
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        "x86_64-pc-windows-msvc"
    }
    #[cfg(not(any(
        all(target_os = "macos", target_arch = "aarch64"),
        all(target_os = "macos", target_arch = "x86_64"),
        all(target_os = "linux", target_arch = "aarch64"),
        all(target_os = "linux", target_arch = "x86_64"),
        all(target_os = "windows", target_arch = "aarch64"),
        all(target_os = "windows", target_arch = "x86_64"),
    )))]
    {
        "unknown"
    }
}

pub fn current_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "unknown"
    }
}

pub fn current_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "x86_64") {
        "x86_64"
    } else {
        "unknown"
    }
}

pub fn system_ffmpeg_name() -> &'static str {
    if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    }
}

pub fn system_ffprobe_name() -> &'static str {
    if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    }
}

pub fn system_ytdlp_name() -> &'static str {
    if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    }
}

/// Expected on-disk sidecar filename for the current platform.
pub fn sidecar_filename(name: &str) -> String {
    let triple = current_target_triple();
    if cfg!(windows) {
        format!("{name}-{triple}.exe")
    } else {
        format!("{name}-{triple}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triple_is_known_on_supported_platforms() {
        let triple = current_target_triple();
        assert_ne!(triple, "unknown", "unsupported compile target");
        assert!(
            triple.contains("apple-darwin")
                || triple.contains("unknown-linux-gnu")
                || triple.contains("pc-windows-msvc")
        );
    }

    #[test]
    fn sidecar_filename_includes_triple() {
        let name = sidecar_filename("ffmpeg");
        assert!(name.starts_with("ffmpeg-"));
        assert!(name.contains(current_target_triple()));
        if cfg!(windows) {
            assert!(name.ends_with(".exe"));
        } else {
            assert!(!name.ends_with(".exe"));
        }
    }
}
