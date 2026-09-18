use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::FFmpegService;

/// Rotate (0/90/180/270 clockwise) and/or flip a video.
#[tauri::command(rename_all = "snake_case")]
pub async fn transform_video(
    app: AppHandle,
    input_path: String,
    output_path: String,
    rotate_degrees: i32,
    hflip: Option<bool>,
    vflip: Option<bool>,
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
    FFmpegService::transform(
        &app,
        &input_path,
        &output_path,
        rotate_degrees,
        hflip.unwrap_or(false),
        vflip.unwrap_or(false),
        video_codec.as_deref(),
        crf,
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
