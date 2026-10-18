use std::fmt::{Display, Formatter};

pub use crate::core::error::ErrorKind;

#[derive(Debug)]
pub struct GitReadError {
    pub kind: ErrorKind,
    pub message: String,
}

impl GitReadError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn from_gix(context: &str, error: impl Display) -> Self {
        let message = format!("{context}: {error}");
        let lower = message.to_ascii_lowercase();
        let kind = if lower.contains("not a git repository")
            || lower.contains("could not find repository")
            || lower.contains("does not appear to be a git repository")
        {
            ErrorKind::NotRepository
        } else if lower.contains("not found") || lower.contains("did not exist") {
            ErrorKind::NotFound
        } else if lower.contains("unsupported")
            || lower.contains("sparse index")
            || lower.contains("split index")
        {
            ErrorKind::Unsupported
        } else if lower.contains("permission denied") || lower.contains("i/o") {
            ErrorKind::Io
        } else {
            ErrorKind::Corrupt
        };
        Self::new(kind, message)
    }
}

impl Display for GitReadError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind.as_str(), self.message)
    }
}

impl std::error::Error for GitReadError {}
