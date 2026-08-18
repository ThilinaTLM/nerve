#[derive(Clone, Debug)]
pub struct SnapshotOptions {
    pub include_ignored: bool,
    pub recent_commit_limit: usize,
    pub status_limit: usize,
    pub ref_limit: usize,
    pub stash_limit: usize,
}

impl Default for SnapshotOptions {
    fn default() -> Self {
        Self {
            include_ignored: false,
            recent_commit_limit: 10,
            status_limit: 100_000,
            ref_limit: 100_000,
            stash_limit: 1_000,
        }
    }
}

#[derive(Clone, Debug)]
pub struct RepositoryInfo {
    pub git_dir: String,
    pub work_dir: Option<String>,
    pub bare: bool,
}

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub git_dir: String,
    pub work_dir: Option<String>,
    pub head_oid: Option<String>,
    pub head_branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub refs: Vec<Reference>,
    pub remotes: Vec<Remote>,
    pub files: Vec<FileStatus>,
    pub recent_commits: Vec<RecentCommit>,
    pub stashes: Vec<Stash>,
}

#[derive(Clone, Debug)]
pub struct Reference {
    pub name: String,
    pub target: Option<String>,
    pub symbolic_target: Option<String>,
    pub upstream: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Remote {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct FileStatus {
    pub path: String,
    pub renamed_from: Option<String>,
    pub index: String,
    pub worktree: String,
    pub untracked: bool,
    pub ignored: bool,
}

#[derive(Clone, Debug)]
pub struct RecentCommit {
    pub oid: String,
    pub subject: String,
    pub timestamp_seconds: i64,
}

#[derive(Clone, Debug)]
pub struct Stash {
    pub index: u32,
    pub oid: String,
    pub message: String,
    pub timestamp_seconds: i64,
}

#[derive(Clone, Debug)]
pub enum DocumentSourceKind {
    Revision(String),
    Index,
    Worktree,
    Empty,
}

#[derive(Clone, Debug)]
pub struct DocumentSource {
    pub kind: DocumentSourceKind,
    pub path: String,
}

#[derive(Clone, Debug)]
pub struct FileDocument {
    pub content: Option<String>,
    pub binary: bool,
    pub size: u32,
}

#[derive(Clone, Debug)]
pub struct FileDiff {
    pub original: FileDocument,
    pub modified: FileDocument,
}

#[derive(Clone, Debug)]
pub struct Ancestry {
    pub ancestor_oid: String,
    pub descendant_oid: String,
    pub is_ancestor: bool,
}
