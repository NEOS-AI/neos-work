use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::FFmpegService;

/// Extract an audio track from a video file.
///
/// # Arguments
/// * `input_path`  — Source video file
/// * `output_path` — Destination audio file (extension determines container)
/// * `codec`       — Audio codec: `"mp3"`, `"aac"`, `"flac"`, `"pcm_s16le"`, etc.
/// * `bitrate`     — Optional bitrate string, e.g. `"192k"`
/// * `stream_index` — Absolute stream index in the input (first audio if omitted)
/// * `duration_secs` — Total source duration in seconds (used for progress %)
#[tauri::command(rename_all = "snake_case")]
pub async fn extract_audio(
    app: AppHandle,
    input_path: String,
    output_path: String,
    codec: String,
    bitrate: Option<String>,
    stream_index: Option<u32>,
    duration_secs: Option<f64>,
    job_id: Option<String>,
) -> Result<(), AppError> {
    if input_path.is_empty() || output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "input_path and output_path must not be empty".into(),
        ));
    }
    FFmpegService::extract_audio(
        &app,
        &input_path,
        &output_path,
        &codec,
        bitrate.as_deref(),
        stream_index,
        duration_secs,
        job_id.as_deref(),
    )
    .await
}

/// Extract a subtitle stream to `.srt` / `.ass` / `.vtt` (or stream-copy).
#[tauri::command(rename_all = "snake_case")]
pub async fn extract_subtitle(
    app: AppHandle,
    input_path: String,
    output_path: String,
    stream_index: u32,
    duration_secs: Option<f64>,
    job_id: Option<String>,
) -> Result<(), AppError> {
    if input_path.is_empty() || output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "input_path and output_path must not be empty".into(),
        ));
    }
    FFmpegService::extract_subtitle(
        &app,
        &input_path,
        &output_path,
        stream_index,
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
