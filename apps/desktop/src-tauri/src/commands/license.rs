use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::models::error::AppError;
use crate::services::license::{
    entitlement_from_env_and_file, Entitlement, LicenseView,
};

#[derive(Default)]
pub struct LicenseState {
    path: Mutex<Option<String>>,
}

impl LicenseState {
    pub fn path(&self) -> Option<String> {
        self.path.lock().ok().and_then(|g| g.clone())
    }

    pub fn set_path(&self, path: Option<String>) {
        if let Ok(mut guard) = self.path.lock() {
            *guard = path.filter(|p| !p.trim().is_empty());
        }
    }

    pub fn view(&self) -> LicenseView {
        entitlement_from_env_and_file(self.path().as_deref())
    }
}

#[derive(Debug, Serialize)]
pub struct LicenseInfo {
    pub tier: String,
    pub path: Option<String>,
    pub expires_unix: Option<i64>,
    pub source: String,
    pub error: Option<String>,
}

impl LicenseInfo {
    fn from_state(state: &LicenseState) -> Self {
        let view = state.view();
        Self {
            tier: view.entitlement.as_str().into(),
            path: state.path(),
            expires_unix: view.expires_unix,
            source: view.source.into(),
            error: view.error,
        }
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_license_file(
    state: State<LicenseState>,
    path: Option<String>,
) -> Result<LicenseInfo, AppError> {
    state.set_path(path);
    Ok(LicenseInfo::from_state(&state))
}

#[tauri::command(rename_all = "snake_case")]
pub fn license_status(state: State<LicenseState>) -> LicenseInfo {
    LicenseInfo::from_state(&state)
}

#[allow(dead_code)]
pub fn require_pro_state(state: &LicenseState) -> Result<Entitlement, AppError> {
    crate::services::license::require_pro(&state.view())?;
    Ok(Entitlement::Pro)
}
