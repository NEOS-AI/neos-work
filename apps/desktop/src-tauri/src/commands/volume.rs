use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::volume::VolumeService;

/// Adjust gain (`gain_db`) and/or apply EBU R128 `loudnorm`.
#[tauri::command(rename_all = "snake_case")]
pub async fn adjust_volume(
    app: AppHandle,
    input_path: String,
    output_path: String,
    normalize: Option<bool>,
    gain_db: Option<f64>,
    duration_secs: Option<f64>,
    job_id: Option<String>,
) -> Result<(), AppError> {
    if input_path.is_empty() || output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "input_path and output_path must not be empty".into(),
        ));
    }
    VolumeService::adjust(
        &app,
        &input_path,
        &output_path,
        normalize.unwrap_or(false),
        gain_db.unwrap_or(0.0),
        duration_secs,
        job_id.as_deref(),
    )
    .await
}
