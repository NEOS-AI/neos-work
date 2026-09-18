use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::crop::CropService;

/// Crop a rectangle from a video and re-encode.
#[tauri::command(rename_all = "snake_case")]
pub async fn crop_video(
    app: AppHandle,
    input_path: String,
    output_path: String,
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    video_codec: Option<String>,
    crf: Option<u8>,
    duration_secs: Option<f64>,
    job_id: Option<String>,
) -> Result<(), AppError> {
    if input_path.is_empty() || output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "input_path and output_path must not be empty".into(),
        ));
    }
    CropService::crop(
        &app,
        &input_path,
        &output_path,
        width,
        height,
        x,
        y,
        video_codec.as_deref(),
        crf,
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
