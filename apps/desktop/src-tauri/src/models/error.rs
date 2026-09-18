use serde::Serialize;

#[derive(Debug)]
pub enum AppError {
    Ffmpeg(String),
    Ffprobe(String),
    FileNotFound(String),
    InvalidArgument(String),
    Parse(serde_json::Error),
    Io(std::io::Error),
    Sidecar(String),
    Ytdlp(String),
    License(String),
    Cancelled,
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Ffmpeg(s) => write!(f, "FFmpeg error: {s}"),
            Self::Ffprobe(s) => write!(f, "FFprobe error: {s}"),
            Self::FileNotFound(s) => write!(f, "File not found: {s}"),
            Self::InvalidArgument(s) => write!(f, "Invalid argument: {s}"),
            Self::Parse(e) => write!(f, "JSON parse error: {e}"),
            Self::Io(e) => write!(f, "IO error: {e}"),
            Self::Sidecar(s) => write!(f, "Sidecar error: {s}"),
            Self::Ytdlp(s) => write!(f, "yt-dlp error: {s}"),
            Self::License(s) => write!(f, "License error: {s}"),
            Self::Cancelled => write!(f, "Operation cancelled"),
        }
    }
}

impl std::error::Error for AppError {}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self::Parse(value)
    }
}

impl From<std::io::Error> for AppError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

/// Implement Serialize so AppError can be returned via Tauri IPC
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
