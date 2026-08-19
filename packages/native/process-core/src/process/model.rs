#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Containment {
    JobObject,
    ProcessGroup,
    Other(String),
}

impl Containment {
    pub fn from_boundary(value: String) -> Self {
        match value.as_str() {
            "job-object" => Self::JobObject,
            "process-group" => Self::ProcessGroup,
            _ => Self::Other(value),
        }
    }

    pub fn as_str(&self) -> &str {
        match self {
            Self::JobObject => "job-object",
            Self::ProcessGroup => "process-group",
            Self::Other(value) => value,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProcessPriority {
    Normal,
    BelowNormal,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ManagedTarget {
    pub pid: u32,
    pub process_group_id: Option<u32>,
    pub containment: Containment,
    pub identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum InspectionEvidence {
    AliveVerified,
    ExitedVerified,
    IdentityMismatch,
    Unknown,
}

impl InspectionEvidence {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::AliveVerified => "alive_verified",
            Self::ExitedVerified => "exited_verified",
            Self::IdentityMismatch => "identity_mismatch",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InspectionResult {
    pub evidence: InspectionEvidence,
    pub detail: Option<String>,
}

impl InspectionResult {
    pub fn alive() -> Self {
        Self {
            evidence: InspectionEvidence::AliveVerified,
            detail: None,
        }
    }

    pub fn exited() -> Self {
        Self {
            evidence: InspectionEvidence::ExitedVerified,
            detail: None,
        }
    }

    pub fn mismatch() -> Self {
        Self {
            evidence: InspectionEvidence::IdentityMismatch,
            detail: Some("PID was reused by another process".to_string()),
        }
    }

    pub fn unknown(detail: impl Into<String>) -> Self {
        Self {
            evidence: InspectionEvidence::Unknown,
            detail: Some(detail.into()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminationMethod {
    #[cfg(windows)]
    JobObject,
    #[cfg(unix)]
    ProcessGroup,
    #[cfg(windows)]
    ProcessTree,
    #[cfg(unix)]
    DirectChild,
    None,
}

impl TerminationMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            #[cfg(windows)]
            Self::JobObject => "job-object",
            #[cfg(unix)]
            Self::ProcessGroup => "process-group",
            #[cfg(windows)]
            Self::ProcessTree => "process-tree",
            #[cfg(unix)]
            Self::DirectChild => "direct-child",
            Self::None => "none",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TerminationResult {
    pub attempted: bool,
    pub terminated: bool,
    pub method: TerminationMethod,
    pub error: Option<String>,
}

impl TerminationResult {
    pub fn not_attempted(method: TerminationMethod, error: Option<String>) -> Self {
        Self {
            attempted: false,
            terminated: false,
            method,
            error,
        }
    }

    pub fn terminated(method: TerminationMethod) -> Self {
        Self {
            attempted: true,
            terminated: true,
            method,
            error: None,
        }
    }

    pub fn failed(method: TerminationMethod, error: impl Into<String>) -> Self {
        Self {
            attempted: true,
            terminated: false,
            method,
            error: Some(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Containment, InspectionResult, TerminationMethod};

    #[test]
    fn preserves_unknown_boundary_containment() {
        let containment = Containment::from_boundary("future-containment".to_string());
        assert_eq!(containment.as_str(), "future-containment");
    }

    #[test]
    fn keeps_stable_boundary_values() {
        assert_eq!(
            InspectionResult::alive().evidence.as_str(),
            "alive_verified"
        );
        assert_eq!(TerminationMethod::None.as_str(), "none");
    }
}
