use tauri::{AppHandle, Manager};

use crate::models::error::AppError;
use crate::services::job::JobRegistry;

/// Cancel one FFmpeg job (`job_id`) or every running job when omitted.
#[tauri::command(rename_all = "snake_case")]
pub async fn cancel_job(app: AppHandle, job_id: Option<String>) -> Result<(), AppError> {
    app.state::<JobRegistry>()
        .cancel(job_id.as_deref().filter(|s| !s.is_empty()))
}
