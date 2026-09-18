use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::FFmpegService;

/// Cut a time range from a video.
///
/// `start_secs` / `end_secs` are positions on the source timeline.
/// `stream_copy = true` (default) remuxes; `false` re-encodes for frame-accurate cuts.
#[tauri::command(rename_all = "snake_case")]
pub async fn trim_video(
    app: AppHandle,
    input_path: String,
    output_path: String,
    start_secs: Option<f64>,
    end_secs: Option<f64>,
    stream_copy: Option<bool>,
    duration_secs: Option<f64>,
    job_id: Option<String>,
) -> Result<(), AppError> {
    if input_path.is_empty() || output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "input_path and output_path must not be empty".into(),
        ));
    }
    FFmpegService::trim(
        &app,
        &input_path,
        &output_path,
        start_secs,
        end_secs,
        stream_copy.unwrap_or(true),
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
