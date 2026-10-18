#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ErrorKind {
    NotRepository,
    NotFound,
    Unsupported,
    IsolationRequired,
    InvalidInput,
    Io,
    Corrupt,
    LimitExceeded,
    Internal,
    Cancelled,
}

impl ErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotRepository => "not_repository",
            Self::NotFound => "not_found",
            Self::Unsupported => "unsupported",
            Self::IsolationRequired => "isolation_required",
            Self::InvalidInput => "invalid_input",
            Self::Io => "io",
            Self::Corrupt => "corrupt",
            Self::LimitExceeded => "limit_exceeded",
            Self::Internal => "internal",
            Self::Cancelled => "cancelled",
        }
    }
}

/// Transport-neutral detail. Retryability is an explicit operation policy, not
/// inferred from an OS error string or category alone.
#[derive(Clone, Debug)]
pub struct ErrorDetail {
    pub(crate) category: ErrorKind,
    pub(crate) message: String,
    pub(crate) retryable: bool,
}

impl ErrorDetail {
    pub(crate) fn new(category: ErrorKind, message: impl Into<String>, retryable: bool) -> Self {
        let mut message = message.into();
        // Bound wire errors as well as successful results, without splitting UTF-8.
        if message.len() > 4096 {
            let mut end = 4093;
            while !message.is_char_boundary(end) {
                end -= 1;
            }
            message.truncate(end);
            message.push_str("...");
        }
        Self {
            category,
            message,
            retryable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn envelope_bounds_unicode_and_does_not_infer_retryability() {
        let error = ErrorDetail::new(ErrorKind::Io, "🦀".repeat(2000), false);
        assert!(error.message.len() <= 4096);
        assert!(error.message.ends_with("..."));
        assert!(!error.retryable);
        assert_eq!(error.category.as_str(), "io");
        assert_eq!(
            ErrorDetail::new(ErrorKind::LimitExceeded, "capacity", true).message,
            "capacity"
        );
    }
}
