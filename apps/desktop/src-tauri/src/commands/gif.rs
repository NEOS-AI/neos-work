use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::gif::GifService;

/// Export a time range of a video as a palette-based animated GIF.
///
/// `start_secs` / `end_secs` are positions on the source timeline. Omit both
/// to convert the whole file. `fps` defaults to 10; `width` defaults to 480.
#[tauri::command(rename_all = "snake_case")]
pub async fn export_gif(
    app: AppHandle,
    input_path: String,
    output_path: String,
    start_secs: Option<f64>,
    end_secs: Option<f64>,
    fps: Option<u32>,
    width: Option<u32>,
    duration_secs: Option<f64>,
    job_id: Option<String>,
) -> Result<(), AppError> {
    if input_path.is_empty() || output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "input_path and output_path must not be empty".into(),
        ));
    }
    GifService::export(
        &app,
        &input_path,
        &output_path,
        start_secs,
        end_secs,
        fps.unwrap_or(10),
        width.unwrap_or(480),
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
