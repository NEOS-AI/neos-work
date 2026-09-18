use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::fade::FadeService;

/// Fade video (and optionally audio) in and/or out.
#[tauri::command(rename_all = "snake_case")]
pub async fn fade_video(
    app: AppHandle,
    input_path: String,
    output_path: String,
    fade_in_secs: Option<f64>,
    fade_out_secs: Option<f64>,
    include_audio: Option<bool>,
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
    FadeService::apply(
        &app,
        &input_path,
        &output_path,
        fade_in_secs.unwrap_or(0.0),
        fade_out_secs.unwrap_or(0.0),
        include_audio.unwrap_or(true),
        video_codec.as_deref(),
        crf,
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
