use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri_plugin_shell::process::CommandChild;

use crate::models::error::AppError;

/// Tracks in-flight FFmpeg children so the UI can cancel one job or all of them.
#[derive(Default)]
pub struct JobRegistry {
    children: Mutex<HashMap<String, CommandChild>>,
    cancelled: Mutex<HashSet<String>>,
}

impl JobRegistry {
    /// Register a newly spawned child under `id`.
    /// Duplicate ids are rejected and the new child is killed.
    /// If `cancel` already ran for this id (before spawn), the child is killed
    /// and `Cancelled` is returned — the pending mark is left for `finish`.
    pub fn register(&self, id: &str, child: CommandChild) -> Result<(), AppError> {
        let mut children = self
            .children
            .lock()
            .map_err(|_| AppError::Ffmpeg("job registry lock poisoned".into()))?;
        if children.contains_key(id) {
            let _ = child.kill();
            return Err(AppError::InvalidArgument(format!(
                "job `{id}` is already running"
            )));
        }
        if self.is_cancelled(id) {
            let _ = child.kill();
            return Err(AppError::Cancelled);
        }
        children.insert(id.to_string(), child);
        Ok(())
    }

    pub fn is_cancelled(&self, id: &str) -> bool {
        self.cancelled
            .lock()
            .map(|set| set.contains(id))
            .unwrap_or(false)
    }

    /// Kill one job (`Some(id)`) or every running job (`None`).
    pub fn cancel(&self, id: Option<&str>) -> Result<(), AppError> {
        let mut children = self
            .children
            .lock()
            .map_err(|_| AppError::Ffmpeg("job registry lock poisoned".into()))?;
        let mut cancelled = self
            .cancelled
            .lock()
            .map_err(|_| AppError::Ffmpeg("job registry lock poisoned".into()))?;

        match id {
            Some(id) if !id.is_empty() => {
                cancelled.insert(id.to_string());
                if let Some(child) = children.remove(id) {
                    child
                        .kill()
                        .map_err(|e| AppError::Ffmpeg(format!("failed to cancel FFmpeg: {e}")))?;
                }
            }
            _ => {
                let ids: Vec<String> = children.keys().cloned().collect();
                for job_id in ids {
                    cancelled.insert(job_id.clone());
                    if let Some(child) = children.remove(&job_id) {
                        let _ = child.kill();
                    }
                }
            }
        }
        Ok(())
    }

    /// Drop the stored child and return whether that job was cancelled.
    pub fn finish(&self, id: &str) -> bool {
        if let Ok(mut children) = self.children.lock() {
            children.remove(id);
        }
        self.cancelled
            .lock()
            .map(|mut set| set.remove(id))
            .unwrap_or(false)
    }
}

pub fn generate_job_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("job-{nanos}")
}

pub fn resolve_job_id(provided: Option<&str>) -> String {
    match provided {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => generate_job_id(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_keeps_non_empty_id() {
        assert_eq!(resolve_job_id(Some("abc")), "abc");
    }

    #[test]
    fn resolve_generates_when_missing() {
        let a = resolve_job_id(None);
        assert!(a.starts_with("job-"));
        assert_ne!(resolve_job_id(Some("")), a); // both generated, almost certainly different
    }

    #[test]
    fn cancel_before_register_stays_marked() {
        let registry = JobRegistry::default();
        registry.cancel(Some("job-1")).unwrap();
        assert!(registry.is_cancelled("job-1"));
        assert!(registry.finish("job-1"));
        assert!(!registry.is_cancelled("job-1"));
    }
}
