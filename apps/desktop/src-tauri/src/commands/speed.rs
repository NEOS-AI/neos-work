use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::speed::SpeedService;

/// Re-encode a video so it plays faster or slower.
///
/// `has_audio` defaults to `true`. When `false`, only the video stream is mapped.
#[tauri::command(rename_all = "snake_case")]
pub async fn change_speed(
    app: AppHandle,
    input_path: String,
    output_path: String,
    rate: f64,
    has_audio: Option<bool>,
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
    SpeedService::change(
        &app,
        &input_path,
        &output_path,
        rate,
        has_audio.unwrap_or(true),
        video_codec.as_deref(),
        crf,
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
