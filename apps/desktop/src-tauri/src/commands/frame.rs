use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::FFmpegService;

/// Save a single video frame at `at_secs` as an image (png/jpg from the extension).
#[tauri::command(rename_all = "snake_case")]
pub async fn export_frame(
    app: AppHandle,
    input_path: String,
    output_path: String,
    at_secs: f64,
    job_id: Option<String>,
) -> Result<(), AppError> {
    if input_path.is_empty() || output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "input_path and output_path must not be empty".into(),
        ));
    }
    FFmpegService::export_frame(&app, &input_path, &output_path, at_secs, job_id.as_deref()).await
}
