use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::FFmpegService;

/// Resize a video to `width × height`.
///
/// Pass `-2` for either dimension to preserve the aspect ratio.
/// `video_codec` defaults to `libx264`; hardware encoders are accepted.
#[tauri::command(rename_all = "snake_case")]
pub async fn resize_video(
    app: AppHandle,
    input_path: String,
    output_path: String,
    width: i32,
    height: i32,
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
    if width == 0 || height == 0 {
        return Err(AppError::InvalidArgument(
            "width and height must be non-zero (use -2 to auto-calculate preserving aspect ratio)"
                .into(),
        ));
    }
    if width < -2 || height < -2 {
        return Err(AppError::InvalidArgument(
            "negative values other than -2 are not valid for width/height".into(),
        ));
    }
    if width == -2 && height == -2 {
        return Err(AppError::InvalidArgument(
            "at least one of width or height must be a positive value".into(),
        ));
    }
    FFmpegService::resize(
        &app,
        &input_path,
        &output_path,
        width,
        height,
        video_codec.as_deref(),
        crf,
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
