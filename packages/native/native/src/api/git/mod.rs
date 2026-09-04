use napi::Env;
use napi::bindgen_prelude::{AsyncTask, Result, Task};
use napi_derive::napi;

use crate::git::{
    self, Ancestry, DocumentSource, DocumentSourceKind, FileDiff, GitReadError, RepositoryInfo,
    Snapshot, SnapshotOptions,
};

#[napi(object)]
pub struct NativeGitSnapshotOptions {
    pub include_ignored: Option<bool>,
    pub recent_commit_limit: Option<u32>,
    pub status_limit: Option<u32>,
    pub ref_limit: Option<u32>,
    pub stash_limit: Option<u32>,
}

#[napi(object)]
pub struct NativeGitRepositoryInfo {
    pub git_dir: String,
    pub work_dir: Option<String>,
    pub bare: bool,
}

#[napi(object)]
pub struct NativeGitRepositoryInfoResult {
    pub repository: Option<NativeGitRepositoryInfo>,
    pub error: Option<NativeGitError>,
}

#[napi(object)]
pub struct NativeGitError {
    pub category: String,
    pub message: String,
}

#[napi(object)]
pub struct NativeGitReference {
    pub name: String,
    pub target: Option<String>,
    pub symbolic_target: Option<String>,
    pub upstream: Option<String>,
    pub commit_timestamp_seconds: Option<f64>,
}

#[napi(object)]
pub struct NativeGitRemote {
    pub name: String,
    pub fetch_url: Option<String>,
    pub push_url: Option<String>,
}

#[napi(object)]
pub struct NativeGitFileStatus {
    pub path: String,
    pub renamed_from: Option<String>,
    pub index: String,
    pub worktree: String,
    pub untracked: bool,
    pub ignored: bool,
}

#[napi(object)]
pub struct NativeGitRecentCommit {
    pub oid: String,
    pub subject: String,
    pub timestamp_seconds: f64,
}

#[napi(object)]
pub struct NativeGitStash {
    pub index: u32,
    pub oid: String,
    pub message: String,
    pub timestamp_seconds: f64,
}

#[napi(object)]
pub struct NativeGitSnapshot {
    pub git_dir: String,
    pub work_dir: Option<String>,
    pub head_oid: Option<String>,
    pub head_branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub refs: Vec<NativeGitReference>,
    pub remotes: Vec<NativeGitRemote>,
    pub files: Vec<NativeGitFileStatus>,
    pub recent_commits: Vec<NativeGitRecentCommit>,
    pub stashes: Vec<NativeGitStash>,
}

#[napi(object)]
pub struct NativeGitSnapshotResult {
    pub snapshot: Option<NativeGitSnapshot>,
    pub error: Option<NativeGitError>,
}

#[napi(object)]
pub struct NativeGitAncestry {
    pub ancestor_oid: String,
    pub descendant_oid: String,
    pub is_ancestor: bool,
}

#[napi(object)]
pub struct NativeGitAncestryResult {
    pub ancestry: Option<NativeGitAncestry>,
    pub error: Option<NativeGitError>,
}

#[napi(object)]
pub struct NativeGitDocumentSource {
    pub kind: String,
    pub revision: Option<String>,
    pub path: String,
}

#[napi(object)]
pub struct NativeGitFileDocument {
    pub content: Option<String>,
    pub binary: bool,
    pub size: u32,
}

#[napi(object)]
pub struct NativeGitFileDiff {
    pub original: NativeGitFileDocument,
    pub modified: NativeGitFileDocument,
}

#[napi(object)]
pub struct NativeGitFileDiffResult {
    pub diff: Option<NativeGitFileDiff>,
    pub error: Option<NativeGitError>,
}

#[napi(object)]
pub struct NativeGitRevisionResult {
    pub oid: Option<String>,
    pub error: Option<NativeGitError>,
}

pub struct RepositoryInfoTask {
    path: String,
}

impl Task for RepositoryInfoTask {
    type Output = std::result::Result<RepositoryInfo, GitReadError>;
    type JsValue = NativeGitRepositoryInfoResult;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(git::read_repository_info(&self.path))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(match output {
            Ok(repository) => NativeGitRepositoryInfoResult {
                repository: Some(NativeGitRepositoryInfo {
                    git_dir: repository.git_dir,
                    work_dir: repository.work_dir,
                    bare: repository.bare,
                }),
                error: None,
            },
            Err(error) => NativeGitRepositoryInfoResult {
                repository: None,
                error: Some(error.into()),
            },
        })
    }
}

#[napi]
pub fn read_git_repository_info(path: String) -> AsyncTask<RepositoryInfoTask> {
    AsyncTask::new(RepositoryInfoTask { path })
}

pub struct SnapshotTask {
    path: String,
    options: SnapshotOptions,
}

impl Task for SnapshotTask {
    type Output = std::result::Result<Snapshot, GitReadError>;
    type JsValue = NativeGitSnapshotResult;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(git::read_snapshot(&self.path, self.options.clone()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(match output {
            Ok(snapshot) => NativeGitSnapshotResult {
                snapshot: Some(snapshot.into()),
                error: None,
            },
            Err(error) => NativeGitSnapshotResult {
                snapshot: None,
                error: Some(error.into()),
            },
        })
    }
}

#[napi]
pub fn read_git_snapshot(
    path: String,
    options: Option<NativeGitSnapshotOptions>,
) -> AsyncTask<SnapshotTask> {
    AsyncTask::new(SnapshotTask {
        path,
        options: options.map(Into::into).unwrap_or_default(),
    })
}

pub struct AncestryTask {
    path: String,
    ancestor: String,
    descendant: String,
}

impl Task for AncestryTask {
    type Output = std::result::Result<Ancestry, GitReadError>;
    type JsValue = NativeGitAncestryResult;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(git::check_ancestry(
            &self.path,
            &self.ancestor,
            &self.descendant,
        ))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(match output {
            Ok(ancestry) => NativeGitAncestryResult {
                ancestry: Some(ancestry.into()),
                error: None,
            },
            Err(error) => NativeGitAncestryResult {
                ancestry: None,
                error: Some(error.into()),
            },
        })
    }
}

#[napi]
pub fn check_git_ancestry(
    path: String,
    ancestor: String,
    descendant: String,
) -> AsyncTask<AncestryTask> {
    AsyncTask::new(AncestryTask {
        path,
        ancestor,
        descendant,
    })
}

pub struct RevisionTask {
    path: String,
    revision: String,
}

impl Task for RevisionTask {
    type Output = std::result::Result<String, GitReadError>;
    type JsValue = NativeGitRevisionResult;

    fn compute(&mut self) -> Result<Self::Output> {
        Ok(git::resolve_revision(&self.path, &self.revision))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(match output {
            Ok(oid) => NativeGitRevisionResult {
                oid: Some(oid),
                error: None,
            },
            Err(error) => NativeGitRevisionResult {
                oid: None,
                error: Some(error.into()),
            },
        })
    }
}

#[napi]
pub fn resolve_git_revision(path: String, revision: String) -> AsyncTask<RevisionTask> {
    AsyncTask::new(RevisionTask { path, revision })
}

pub struct FileDiffTask {
    path: String,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
}

impl Task for FileDiffTask {
    type Output = std::result::Result<FileDiff, GitReadError>;
    type JsValue = NativeGitFileDiffResult;

    fn compute(&mut self) -> Result<Self::Output> {
        let original = document_source(&self.original);
        let modified = document_source(&self.modified);
        Ok(match (original, modified) {
            (Ok(original), Ok(modified)) => git::read_file_diff(&self.path, original, modified),
            (Err(error), _) | (_, Err(error)) => Err(error),
        })
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(match output {
            Ok(diff) => NativeGitFileDiffResult {
                diff: Some(diff.into()),
                error: None,
            },
            Err(error) => NativeGitFileDiffResult {
                diff: None,
                error: Some(error.into()),
            },
        })
    }
}

#[napi]
pub fn read_git_file_diff(
    path: String,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
) -> AsyncTask<FileDiffTask> {
    AsyncTask::new(FileDiffTask {
        path,
        original,
        modified,
    })
}

fn document_source(
    value: &NativeGitDocumentSource,
) -> std::result::Result<DocumentSource, GitReadError> {
    let kind = match value.kind.as_str() {
        "empty" => DocumentSourceKind::Empty,
        "index" => DocumentSourceKind::Index,
        "worktree" => DocumentSourceKind::Worktree,
        "revision" => DocumentSourceKind::Revision(value.revision.clone().ok_or_else(|| {
            GitReadError::new(
                git::ErrorKind::InvalidInput,
                "revision source requires a revision",
            )
        })?),
        _ => {
            return Err(GitReadError::new(
                git::ErrorKind::InvalidInput,
                "unknown document source kind",
            ));
        }
    };
    Ok(DocumentSource {
        kind,
        path: value.path.clone(),
    })
}

#[napi]
pub fn validate_git_branch_name(name: String) -> bool {
    git::validate_branch_name(&name).unwrap_or(false)
}

impl From<NativeGitSnapshotOptions> for SnapshotOptions {
    fn from(value: NativeGitSnapshotOptions) -> Self {
        let defaults = Self::default();
        Self {
            include_ignored: value.include_ignored.unwrap_or(defaults.include_ignored),
            recent_commit_limit: value
                .recent_commit_limit
                .map(|value| value as usize)
                .unwrap_or(defaults.recent_commit_limit),
            status_limit: value
                .status_limit
                .map(|value| value as usize)
                .unwrap_or(defaults.status_limit),
            ref_limit: value
                .ref_limit
                .map(|value| value as usize)
                .unwrap_or(defaults.ref_limit),
            stash_limit: value
                .stash_limit
                .map(|value| value as usize)
                .unwrap_or(defaults.stash_limit),
        }
    }
}

impl From<GitReadError> for NativeGitError {
    fn from(value: GitReadError) -> Self {
        Self {
            category: value.kind.as_str().to_string(),
            message: value.message,
        }
    }
}

impl From<Snapshot> for NativeGitSnapshot {
    fn from(value: Snapshot) -> Self {
        Self {
            git_dir: value.git_dir,
            work_dir: value.work_dir,
            head_oid: value.head_oid,
            head_branch: value.head_branch,
            detached: value.detached,
            upstream: value.upstream,
            ahead: value.ahead,
            behind: value.behind,
            refs: value
                .refs
                .into_iter()
                .map(|value| NativeGitReference {
                    name: value.name,
                    target: value.target,
                    symbolic_target: value.symbolic_target,
                    upstream: value.upstream,
                    commit_timestamp_seconds: value
                        .commit_timestamp_seconds
                        .map(|timestamp| timestamp as f64),
                })
                .collect(),
            remotes: value
                .remotes
                .into_iter()
                .map(|value| NativeGitRemote {
                    name: value.name,
                    fetch_url: value.fetch_url,
                    push_url: value.push_url,
                })
                .collect(),
            files: value
                .files
                .into_iter()
                .map(|value| NativeGitFileStatus {
                    path: value.path,
                    renamed_from: value.renamed_from,
                    index: value.index,
                    worktree: value.worktree,
                    untracked: value.untracked,
                    ignored: value.ignored,
                })
                .collect(),
            recent_commits: value
                .recent_commits
                .into_iter()
                .map(|value| NativeGitRecentCommit {
                    oid: value.oid,
                    subject: value.subject,
                    timestamp_seconds: value.timestamp_seconds as f64,
                })
                .collect(),
            stashes: value
                .stashes
                .into_iter()
                .map(|value| NativeGitStash {
                    index: value.index,
                    oid: value.oid,
                    message: value.message,
                    timestamp_seconds: value.timestamp_seconds as f64,
                })
                .collect(),
        }
    }
}

impl From<FileDiff> for NativeGitFileDiff {
    fn from(value: FileDiff) -> Self {
        Self {
            original: NativeGitFileDocument {
                content: value.original.content,
                binary: value.original.binary,
                size: value.original.size,
            },
            modified: NativeGitFileDocument {
                content: value.modified.content,
                binary: value.modified.binary,
                size: value.modified.size,
            },
        }
    }
}

impl From<Ancestry> for NativeGitAncestry {
    fn from(value: Ancestry) -> Self {
        Self {
            ancestor_oid: value.ancestor_oid,
            descendant_oid: value.descendant_oid,
            is_ancestor: value.is_ancestor,
        }
    }
}
