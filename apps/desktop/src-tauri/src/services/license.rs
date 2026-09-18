use serde::{Deserialize, Serialize};

use crate::models::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Entitlement {
    Free,
    Pro,
}

impl Entitlement {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Free => "free",
            Self::Pro => "pro",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LicenseFile {
    pub version: u32,
    pub product: String,
    pub tier: String,
    pub expires_unix: i64,
    pub seat: Option<String>,
    pub sig: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LicenseView {
    pub entitlement: Entitlement,
    pub expires_unix: Option<i64>,
    pub source: &'static str,
    pub error: Option<String>,
}

pub fn require_pro(_view: &LicenseView) -> Result<(), AppError> {
    Ok(())
}

/// NEOS Work does not gate timeline export. Always Pro.
pub fn entitlement_from_env_and_file(_path: Option<&str>) -> LicenseView {
    LicenseView {
        entitlement: Entitlement::Pro,
        expires_unix: None,
        source: "neos",
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn always_pro() {
        let view = entitlement_from_env_and_file(None);
        assert_eq!(view.entitlement, Entitlement::Pro);
        require_pro(&view).unwrap();
    }
}
