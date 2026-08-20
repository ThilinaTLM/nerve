#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum Containment {
    JobObject,
    ProcessGroup,
    Other(String),
}

impl Containment {
    pub(crate) fn from_boundary(value: String) -> Self {
        match value.as_str() {
            "job-object" => Self::JobObject,
            "process-group" => Self::ProcessGroup,
            _ => Self::Other(value),
        }
    }

    pub(crate) fn as_str(&self) -> &str {
        match self {
            Self::JobObject => "job-object",
            Self::ProcessGroup => "process-group",
            Self::Other(value) => value,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ManagedTarget {
    pub(crate) pid: u32,
    pub(crate) process_group_id: Option<u32>,
    pub(crate) containment: Containment,
    pub(crate) identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum InspectionEvidence {
    AliveVerified,
    ExitedVerified,
    IdentityMismatch,
    Unknown,
}

impl InspectionEvidence {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::AliveVerified => "alive_verified",
            Self::ExitedVerified => "exited_verified",
            Self::IdentityMismatch => "identity_mismatch",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct InspectionResult {
    pub(crate) evidence: InspectionEvidence,
    pub(crate) detail: Option<String>,
}

impl InspectionResult {
    pub(crate) fn alive() -> Self {
        Self {
            evidence: InspectionEvidence::AliveVerified,
            detail: None,
        }
    }

    pub(crate) fn exited() -> Self {
        Self {
            evidence: InspectionEvidence::ExitedVerified,
            detail: None,
        }
    }

    pub(crate) fn mismatch() -> Self {
        Self {
            evidence: InspectionEvidence::IdentityMismatch,
            detail: Some("PID was reused by another process".to_string()),
        }
    }

    pub(crate) fn unknown(detail: impl Into<String>) -> Self {
        Self {
            evidence: InspectionEvidence::Unknown,
            detail: Some(detail.into()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TerminationMethod {
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
    pub(crate) fn as_str(self) -> &'static str {
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ExitReason {
    Exited,
    Signal,
    Timeout,
    #[cfg(target_os = "linux")]
    MemoryLimit,
    #[cfg(target_os = "linux")]
    ProcessLimit,
    OutputLimit,
    Internal,
}

impl ExitReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Exited => "exited",
            Self::Signal => "signal",
            Self::Timeout => "timeout",
            #[cfg(target_os = "linux")]
            Self::MemoryLimit => "memory_limit",
            #[cfg(target_os = "linux")]
            Self::ProcessLimit => "process_limit",
            Self::OutputLimit => "output_limit",
            Self::Internal => "internal",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct EnforcementEntry {
    pub(crate) resource: String,
    pub(crate) status: String,
    pub(crate) method: String,
    pub(crate) detail: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TerminationResult {
    pub(crate) attempted: bool,
    pub(crate) terminated: bool,
    pub(crate) method: TerminationMethod,
    pub(crate) error: Option<String>,
}

impl TerminationResult {
    pub(crate) fn not_attempted(method: TerminationMethod, error: Option<String>) -> Self {
        Self {
            attempted: false,
            terminated: false,
            method,
            error,
        }
    }

    pub(crate) fn terminated(method: TerminationMethod) -> Self {
        Self {
            attempted: true,
            terminated: true,
            method,
            error: None,
        }
    }

    pub(crate) fn failed(method: TerminationMethod, error: impl Into<String>) -> Self {
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
