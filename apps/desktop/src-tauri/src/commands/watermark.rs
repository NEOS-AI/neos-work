use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::watermark::WatermarkService;

/// Burn an image or text overlay onto a video.
///
/// Provide `image_path` for a logo, or `text` for drawtext. Image wins if both
/// are set. `position` is `tl` / `tr` / `bl` / `br` / `center`.
#[tauri::command(rename_all = "snake_case")]
pub async fn apply_watermark(
    app: AppHandle,
    input_path: String,
    output_path: String,
    position: String,
    image_path: Option<String>,
    text: Option<String>,
    font_path: Option<String>,
    font_size: Option<u32>,
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
    if let Some(image) = image_path.filter(|s| !s.is_empty()) {
        return WatermarkService::apply_image(
            &app,
            &input_path,
            &image,
            &output_path,
            &position,
            video_codec.as_deref(),
            crf,
            duration_secs,
            job_id.as_deref(),
        )
        .await;
    }
    let text = text.filter(|s| !s.is_empty()).ok_or_else(|| {
        AppError::InvalidArgument("provide image_path or text for the watermark".into())
    })?;
    WatermarkService::apply_text(
        &app,
        &input_path,
        &output_path,
        &text,
        &position,
        font_path.as_deref(),
        font_size.unwrap_or(32),
        video_codec.as_deref(),
        crf,
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
