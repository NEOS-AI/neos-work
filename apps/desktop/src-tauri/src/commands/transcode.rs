use serde::Deserialize;
use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::FFmpegService;

#[derive(Debug, Deserialize)]
pub struct TranscodeOptions {
    pub input_path: String,
    pub output_path: String,
    pub video_codec: String,
    pub audio_codec: String,
    /// Constant Rate Factor for quality-based encoding (e.g. 18–28 for H.264).
    /// Hardware encoders remap this to `-q:v` / `-cq` / `-global_quality`.
    pub crf: Option<u8>,
    /// `"copy"` remuxes subtitle streams; `"burn"` hard-burns; `"none"` or omitted drops them.
    pub subtitle_mode: Option<String>,
    /// Absolute subtitle stream index to burn (first subtitle stream if omitted).
    pub subtitle_stream_index: Option<u32>,
    /// Optional external subtitle file to burn instead of an embedded stream.
    pub subtitle_input: Option<String>,
    /// Total source duration in seconds (used for progress %). Auto-probed if omitted.
    pub duration_secs: Option<f64>,
    pub job_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MuxOptions {
    pub video_input: String,
    pub audio_input: String,
    pub output_path: String,
    /// Absolute stream indices in `video_input`. Empty/omitted → first video stream.
    pub video_streams: Option<Vec<u32>>,
    /// Absolute stream indices in `audio_input`. Empty/omitted → first audio stream.
    pub audio_streams: Option<Vec<u32>>,
    /// Absolute subtitle stream indices in `video_input`.
    pub subtitle_streams: Option<Vec<u32>>,
    /// Optional dedicated subtitle file (third FFmpeg input).
    pub subtitle_input: Option<String>,
    /// Absolute stream indices in `subtitle_input`. Empty → first subtitle stream.
    pub subtitle_input_streams: Option<Vec<u32>>,
    pub duration_secs: Option<f64>,
    pub job_id: Option<String>,
}

/// Transcode a video file to a different codec or container.
#[tauri::command(rename_all = "snake_case")]
pub async fn transcode_video(app: AppHandle, options: TranscodeOptions) -> Result<(), AppError> {
    if options.input_path.is_empty() || options.output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "input_path and output_path must not be empty".into(),
        ));
    }
    FFmpegService::transcode(
        &app,
        &options.input_path,
        &options.output_path,
        &options.video_codec,
        &options.audio_codec,
        options.crf,
        options.subtitle_mode.as_deref(),
        options.subtitle_stream_index,
        options
            .subtitle_input
            .as_deref()
            .filter(|s| !s.is_empty()),
        options.duration_secs,
        options.job_id.as_deref(),
    )
    .await
}

/// Mux a separate video and audio file (and optional subtitles) into one container.
#[tauri::command(rename_all = "snake_case")]
pub async fn mux_video(app: AppHandle, options: MuxOptions) -> Result<(), AppError> {
    if options.video_input.is_empty()
        || options.audio_input.is_empty()
        || options.output_path.is_empty()
    {
        return Err(AppError::InvalidArgument(
            "video_input, audio_input, and output_path must not be empty".into(),
        ));
    }
    let empty: Vec<u32> = Vec::new();
    FFmpegService::mux(
        &app,
        &options.video_input,
        &options.audio_input,
        &options.output_path,
        options.video_streams.as_deref().unwrap_or(&empty),
        options.audio_streams.as_deref().unwrap_or(&empty),
        options.subtitle_streams.as_deref().unwrap_or(&empty),
        options
            .subtitle_input
            .as_deref()
            .filter(|s| !s.is_empty()),
        options.subtitle_input_streams.as_deref().unwrap_or(&empty),
        options.duration_secs,
        options.job_id.as_deref(),
    )
    .await
}
