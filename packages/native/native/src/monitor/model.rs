use std::path::PathBuf;
use std::time::{Duration, Instant};

pub const DEFAULT_MAX_SCOPES: usize = 64;
pub const DEFAULT_MAX_REGISTRATIONS: usize = 4_096;
pub const DEFAULT_MAX_DIRECTORIES_PER_SCOPE: usize = 512;
pub const DEFAULT_MAX_GIT_PATHS: usize = 12;
pub const DEFAULT_MAX_PATHS_PER_NOTICE: usize = 256;
pub const DEFAULT_QUIET: Duration = Duration::from_millis(300);
pub const DEFAULT_MAX_WAIT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug)]
pub struct MonitorLimits {
    pub max_scopes: usize,
    pub max_registrations: usize,
    pub max_directories_per_scope: usize,
    pub max_git_paths: usize,
    pub max_paths_per_notice: usize,
}

impl Default for MonitorLimits {
    fn default() -> Self {
        Self {
            max_scopes: DEFAULT_MAX_SCOPES,
            max_registrations: DEFAULT_MAX_REGISTRATIONS,
            max_directories_per_scope: DEFAULT_MAX_DIRECTORIES_PER_SCOPE,
            max_git_paths: DEFAULT_MAX_GIT_PATHS,
            max_paths_per_notice: DEFAULT_MAX_PATHS_PER_NOTICE,
        }
    }
}

#[derive(Clone, Debug)]
pub enum ScopeKind {
    Directories,
    Git { repository: PathBuf },
}

#[derive(Clone, Debug)]
pub struct ScopeSpec {
    pub id: String,
    pub kind: ScopeKind,
    pub paths: Vec<PathBuf>,
    pub poll_interval: Duration,
}

#[derive(Clone, Debug)]
pub struct ScopeState {
    pub generation: u64,
    pub watched_paths: usize,
    pub degraded: bool,
}

#[derive(Clone, Debug)]
pub struct ChangeNotice {
    pub scope_id: String,
    pub generation: u64,
    pub causes: Vec<String>,
    pub paths: Vec<String>,
    pub full_refresh_required: bool,
}

#[derive(Clone, Debug, Default)]
pub struct MonitorDiagnostics {
    pub active_scopes: usize,
    pub registrations: usize,
    pub degraded_scopes: usize,
    pub emitted_notices: u64,
    pub coalesced_triggers: u64,
    pub overflows: u64,
    pub poll_count: u64,
    pub poll_failures: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct PendingChange {
    pub causes: Vec<String>,
    pub paths: Vec<PathBuf>,
    pub full_refresh_required: bool,
    pub quiet_deadline: Instant,
    pub maximum_deadline: Instant,
}

impl PendingChange {
    pub fn new(cause: String, path: Option<PathBuf>, full: bool, now: Instant) -> Self {
        Self {
            causes: vec![cause],
            paths: path.into_iter().collect(),
            full_refresh_required: full,
            quiet_deadline: now + DEFAULT_QUIET,
            maximum_deadline: now + DEFAULT_MAX_WAIT,
        }
    }
}
