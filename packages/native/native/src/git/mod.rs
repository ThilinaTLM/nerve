mod ancestry;
mod error;
mod file_diff;
mod model;
pub(crate) mod napi;
mod project;
mod project_status;
mod read_context;
mod repository;

pub use ancestry::{check as check_ancestry, resolve_revision, validate_branch_name};
pub use error::{ErrorKind, GitReadError};
pub use file_diff::read as read_file_diff;
pub use model::*;
pub use repository::{read_info as read_repository_info, read_snapshot};

pub(crate) use repository::read_monitor_snapshot;

#[cfg(test)]
pub(crate) mod test_support;
