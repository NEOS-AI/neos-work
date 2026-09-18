use serde::Serialize;

/// Runtime environment report: sidecar health, platform, and available HW encoders.
#[derive(Debug, Clone, Serialize)]
pub struct EnvironmentInfo {
    pub os: String,
    pub arch: String,
    pub target_triple: String,
    pub ffmpeg_ok: bool,
    pub ffprobe_ok: bool,
    pub ffmpeg_version: Option<String>,
    pub ffprobe_version: Option<String>,
    pub ffmpeg_source: Option<String>,
    pub ffprobe_source: Option<String>,
    pub ffmpeg_sidecar: String,
    pub ffprobe_sidecar: String,
    pub ytdlp_ok: bool,
    pub ytdlp_version: Option<String>,
    pub ytdlp_source: Option<String>,
    pub ytdlp_sidecar: String,
    pub hw_encoders: Vec<String>,
    pub hw_accels: Vec<String>,
}
