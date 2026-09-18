use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::FFmpegService;

/// Join two or more files in order.
#[tauri::command(rename_all = "snake_case")]
pub async fn concat_videos(
    app: AppHandle,
    inputs: Vec<String>,
    output_path: String,
    stream_copy: Option<bool>,
    job_id: Option<String>,
) -> Result<(), AppError> {
    if output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "output_path must not be empty".into(),
        ));
    }
    FFmpegService::concat(
        &app,
        &inputs,
        &output_path,
        stream_copy.unwrap_or(true),
        job_id.as_deref(),
    )
    .await
}
