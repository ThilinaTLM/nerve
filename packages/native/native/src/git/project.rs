//! Bounded, ephemeral project reads. No N-API and no Git writes.
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use super::project_status::{guard_external_filters, prepare_read_options, submodule_statuses};
use super::{FileStatus, GitReadError};
use crate::core::admission::ActivePermit;
use crate::core::cancellation::CancellationToken;
use crate::core::error::{ErrorDetail, ErrorKind};

pub(crate) const MAX_REPOSITORIES: usize = 128;
const MAX_ENTRIES: usize = 100_000;
const MAX_STATUS: usize = 20_000;
const MAX_BYTES: usize = 8 * 1024 * 1024;
const MAX_WALK: usize = 100_000;
const MAX_PATH: usize = 4096;
// Two calls, each with at most two repository workers. Admission is reserved
// before AsyncTask submission, not after occupying a libuv worker.
static ACTIVE: AtomicUsize = AtomicUsize::new(0);
pub(crate) fn admit() -> Result<ActivePermit<'static>, ErrorDetail> {
    ActivePermit::acquire(&ACTIVE, 2).ok_or_else(|| {
        ErrorDetail::new(
            ErrorKind::LimitExceeded,
            "native Git read capacity reached",
            true,
        )
    })
}
pub(crate) fn check(token: &CancellationToken) -> Result<(), GitReadError> {
    if token.is_cancelled() {
        Err(GitReadError::new(
            ErrorKind::Cancelled,
            "Git read cancelled",
        ))
    } else {
        Ok(())
    }
}
pub(crate) fn detail(error: GitReadError) -> ErrorDetail {
    ErrorDetail::new(error.kind, error.message, false)
}
fn text(path: &Path) -> Result<String, GitReadError> {
    let value = path.to_str().ok_or_else(|| {
        GitReadError::new(ErrorKind::Unsupported, "non-UTF-8 paths are unsupported")
    })?;
    if value.len() > MAX_PATH {
        return Err(limit("path length"));
    }
    Ok(value.to_owned())
}
pub(super) fn limit(what: &str) -> GitReadError {
    GitReadError::new(
        ErrorKind::LimitExceeded,
        format!("Git {what} limit exceeded"),
    )
}
pub(super) fn io(error: std::io::Error) -> GitReadError {
    GitReadError::new(ErrorKind::Io, error.to_string())
}

#[derive(Clone, Debug)]
pub struct Repository {
    pub relative_path: String,
    pub work_dir: String,
    pub git_dir: String,
    pub common_dir: String,
}
#[derive(Debug)]
pub struct Discovery {
    pub root: String,
    pub project_is_repo: bool,
    pub repositories: Vec<Repository>,
}
#[cfg(test)]
fn identity(root: &Path, path: &Path) -> Result<Repository, GitReadError> {
    // Match discover(): compare canonical worktrees with a canonical root, even
    // when the fixture's temporary directory has a symlinked ancestor (macOS).
    let root = root.canonicalize().map_err(io)?;
    identity_with_path_limit(&root, path, MAX_PATH)
}
fn identity_with_path_limit(
    root: &Path,
    path: &Path,
    path_limit: usize,
) -> Result<Repository, GitReadError> {
    let repo = gix::open(path).map_err(|e| GitReadError::from_gix("open repository", e))?;
    let work_dir = repo
        .workdir()
        .ok_or_else(|| GitReadError::new(ErrorKind::Unsupported, "bare repository"))?
        .canonicalize()
        .map_err(io)?;
    if !work_dir.starts_with(root) {
        return Err(GitReadError::new(
            ErrorKind::InvalidInput,
            "worktree outside project",
        ));
    }
    let relative = work_dir.strip_prefix(root).expect("contained");
    let identity = Repository {
        relative_path: if relative.as_os_str().is_empty() {
            ".".into()
        } else {
            text(relative)?.replace(std::path::MAIN_SEPARATOR, "/")
        },
        work_dir: text(&work_dir)?,
        git_dir: text(&repo.git_dir().canonicalize().map_err(io)?)?,
        common_dir: text(&repo.common_dir().canonicalize().map_err(io)?)?,
    };
    if [
        &identity.relative_path,
        &identity.work_dir,
        &identity.git_dir,
        &identity.common_dir,
    ]
    .iter()
    .any(|path| path.len() > path_limit)
    {
        return Err(limit("path length"));
    }
    Ok(identity)
}
fn skippable_identity(error: &GitReadError) -> bool {
    matches!(
        error.kind,
        ErrorKind::NotRepository | ErrorKind::NotFound | ErrorKind::Io | ErrorKind::Corrupt
    ) || (error.kind == ErrorKind::Unsupported && error.message == "bare repository")
}
pub(crate) fn discover(root: &str, token: &CancellationToken) -> Result<Discovery, GitReadError> {
    discover_with_path_limit(root, token, MAX_PATH)
}
fn discover_with_path_limit(
    root: &str,
    token: &CancellationToken,
    path_limit: usize,
) -> Result<Discovery, GitReadError> {
    check(token)?;
    if root.len() > MAX_PATH {
        return Err(limit("path length"));
    }
    let root = Path::new(root).canonicalize().map_err(io)?;
    let mut repositories = Vec::new();
    let root_identity = identity_with_path_limit(&root, &root, path_limit);
    check(token)?;
    let project_is_repo = match root_identity {
        Ok(repo) => {
            repositories.push(repo);
            true
        }
        Err(error) if skippable_identity(&error) => false,
        Err(error) => return Err(error),
    };
    if !project_is_repo {
        let mut pending = vec![(root.clone(), 0)];
        let mut visited = 0;
        while let Some((dir, depth)) = pending.pop() {
            check(token)?;
            let entries = match std::fs::read_dir(&dir) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for entry in entries {
                check(token)?;
                visited += 1;
                if visited > MAX_ENTRIES {
                    return Err(limit("discovery entries"));
                }
                let Ok(entry) = entry else { continue };
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                if !kind.is_dir() || kind.is_symlink() {
                    continue;
                }
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with('.')
                    || ["node_modules", "dist", "build"].contains(&name.as_ref())
                {
                    continue;
                }
                let path = entry.path();
                // Canonical containment also catches a directory changed to a symlink after enumeration.
                let canonical = path.canonicalize().map_err(io)?;
                if !canonical.starts_with(&root) {
                    return Err(GitReadError::new(
                        ErrorKind::InvalidInput,
                        "discovery path escaped project",
                    ));
                }
                if path.join(".git").exists() {
                    match identity_with_path_limit(&root, &path, path_limit) {
                        Ok(repo) => {
                            repositories.push(repo);
                            if repositories.len() > MAX_REPOSITORIES {
                                return Err(limit("repository count"));
                            }
                        }
                        Err(error) if skippable_identity(&error) => {} // Inherited unreadable/corrupt-repository policy.
                        Err(error) => return Err(error),
                    }
                } else if depth < 2 {
                    pending.push((canonical, depth + 1));
                }
            }
        }
    }
    repositories.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(Discovery {
        root: text(&root)?,
        project_is_repo,
        repositories,
    })
}

#[derive(Debug, Default)]
pub struct Counts {
    pub staged: u32,
    pub unstaged: u32,
    pub untracked: u32,
    pub ignored: u32,
    pub conflicted: u32,
}
#[derive(Debug)]
pub struct ProjectSnapshot {
    pub head_oid: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub in_progress: Vec<String>,
    pub counts: Counts,
    pub files: Vec<FileStatus>,
}
#[derive(Debug)]
pub struct RepositoryResult {
    pub repository: Repository,
    pub snapshot: Result<ProjectSnapshot, ErrorDetail>,
}

pub(crate) fn snapshots(
    repositories: Vec<Repository>,
    ignored: bool,
    token: Arc<CancellationToken>,
) -> Result<Vec<RepositoryResult>, GitReadError> {
    if repositories.len() > MAX_REPOSITORIES {
        return Err(limit("repository count"));
    }
    for repo in &repositories {
        for path in [
            &repo.work_dir,
            &repo.git_dir,
            &repo.common_dir,
            &repo.relative_path,
        ] {
            if path.len() > MAX_PATH {
                return Err(limit("path length"));
            }
        }
    }
    check(&token)?;
    let next = AtomicUsize::new(0);
    let results = Mutex::new(Vec::new());
    // Output budget is shared across all workers; failures never return partial file lists.
    let bytes = AtomicUsize::new(0);
    let modules = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..repositories.len().min(2) {
            scope.spawn(|| {
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(repository) = repositories.get(i) else {
                        break;
                    };
                    let snapshot =
                        snapshot_with_modules(repository, ignored, &token, &bytes, &modules)
                            .map_err(detail);
                    results
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .push((
                            i,
                            RepositoryResult {
                                repository: repository.clone(),
                                snapshot,
                            },
                        ));
                }
            });
        }
    });
    check(&token)?;
    let mut results = results
        .into_inner()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    results.sort_by_key(|(i, _)| *i);
    Ok(results.into_iter().map(|(_, result)| result).collect())
}

#[cfg(test)]
fn snapshot(
    identity: &Repository,
    ignored: bool,
    token: &CancellationToken,
    bytes: &AtomicUsize,
) -> Result<ProjectSnapshot, GitReadError> {
    snapshot_with_modules(identity, ignored, token, bytes, &AtomicUsize::new(0))
}
fn snapshot_with_modules(
    identity: &Repository,
    ignored: bool,
    token: &CancellationToken,
    bytes: &AtomicUsize,
    modules: &AtomicUsize,
) -> Result<ProjectSnapshot, GitReadError> {
    check(token)?;
    let mut repo =
        gix::open(&identity.work_dir).map_err(|e| GitReadError::from_gix("open repository", e))?;
    if repo
        .workdir()
        .map(|path| path.canonicalize())
        .transpose()
        .map_err(io)?
        .as_deref()
        .map(text)
        .transpose()?
        .as_deref()
        != Some(identity.work_dir.as_str())
        || text(&repo.git_dir().canonicalize().map_err(io)?)? != identity.git_dir
        || text(&repo.common_dir().canonicalize().map_err(io)?)? != identity.common_dir
    {
        return Err(GitReadError::new(
            ErrorKind::InvalidInput,
            "repository identity changed; rediscover project",
        ));
    }
    repo.object_cache_size_if_unset(4 * 1024 * 1024);
    let head = repo
        .head()
        .map_err(|e| GitReadError::from_gix("read HEAD", e))?;
    let head_oid = head.id().map(|id| id.to_string());
    let branch = head.referent_name().map(|n| n.shorten().to_string());
    let detached = branch.is_none() && head_oid.is_some();
    let upstream = match repo
        .head_ref()
        .map_err(|e| GitReadError::from_gix("read HEAD ref", e))?
        .and_then(|r| r.remote_tracking_ref_name(gix::remote::Direction::Fetch))
    {
        Some(Ok(n)) => Some(n.shorten().to_string()),
        Some(Err(e)) => return Err(GitReadError::from_gix("read upstream", e)),
        None => None,
    };
    let (ahead, behind) = match (&head_oid, &upstream) {
        (Some(a), Some(b)) => (
            Some(count_walk(&repo, a, b, token)?),
            Some(count_walk(&repo, b, a, token)?),
        ),
        _ => (None, None),
    };
    check(token)?;
    let files = status(&mut repo, ignored, token, bytes, modules, 0, false)?.files;
    let mut counts = Counts::default();
    for file in &files {
        if file.ignored {
            counts.ignored += 1;
        } else if file.untracked {
            counts.untracked += 1;
        } else {
            if file.index != " " {
                counts.staged += 1;
            }
            if file.worktree != " " {
                counts.unstaged += 1;
            }
            if file.index == "U" || file.worktree == "U" {
                counts.conflicted += 1;
            }
        }
    }
    let in_progress = read_in_progress(&repo, token)?;
    Ok(ProjectSnapshot {
        head_oid,
        branch,
        detached,
        upstream,
        ahead,
        behind,
        in_progress,
        counts,
        files,
    })
}
pub(super) fn read_in_progress(
    repo: &gix::Repository,
    token: &CancellationToken,
) -> Result<Vec<String>, GitReadError> {
    let mut in_progress = Vec::new();
    for (marker, kind) in [
        ("MERGE_HEAD", "merge"),
        ("rebase-merge", "rebase"),
        ("rebase-apply", "rebase"),
        ("CHERRY_PICK_HEAD", "cherry_pick"),
        ("REVERT_HEAD", "revert"),
        ("BISECT_LOG", "bisect"),
    ] {
        check(token)?;
        if repo.git_dir().join(marker).try_exists().map_err(io)?
            && !in_progress.contains(&kind.to_owned())
        {
            in_progress.push(kind.to_owned());
        }
    }
    Ok(in_progress)
}

fn count_walk(
    repo: &gix::Repository,
    from: &str,
    hidden: &str,
    token: &CancellationToken,
) -> Result<u32, GitReadError> {
    let from = repo
        .rev_parse_single(from)
        .map_err(|e| GitReadError::from_gix("resolve revision", e))?;
    let hidden = repo
        .rev_parse_single(hidden)
        .map_err(|e| GitReadError::from_gix("resolve upstream", e))?;
    let walk = repo
        .rev_walk([from])
        .with_hidden([hidden])
        .all()
        .map_err(|e| GitReadError::from_gix("walk revision", e))?;
    let mut count = 0;
    for item in walk {
        check(token)?;
        item.map_err(|e| GitReadError::from_gix("walk revision", e))?;
        count += 1;
        if count > MAX_WALK {
            return Err(limit("revision walk"));
        }
    }
    Ok(count as u32)
}

struct Collector<'a> {
    files: BTreeMap<String, FileStatus>,
    error: Option<GitReadError>,
    first_change: Option<gix::status::Item>,
    token: &'a CancellationToken,
    bytes: &'a AtomicUsize,
}
impl Collector<'_> {
    fn add(&mut self, item: gix::status::Item) {
        if matches!(
            &item,
            gix::status::Item::IndexWorktree(gix::status::index_worktree::Item::Modification {
                status: gix::status::plumbing::index_as_worktree::EntryStatus::NeedsUpdate(_),
                ..
            })
        ) {
            return;
        }
        if self.error.is_some() {
            return;
        }
        if self.first_change.is_none() {
            self.first_change = Some(item.clone());
        }
        if let Err(error) = check(self.token).and_then(|()| self.add_inner(item)) {
            self.error = Some(error);
        }
    }
    fn add_inner(&mut self, item: gix::status::Item) -> Result<(), GitReadError> {
        use gix::bstr::ByteSlice;
        let path = item
            .location()
            .to_str()
            .map_err(|_| GitReadError::new(ErrorKind::Unsupported, "non-UTF-8 status path"))?
            .to_owned();
        if path.len() > MAX_PATH {
            return Err(limit("path length"));
        }
        if !self.files.contains_key(&path) {
            if self.files.len() >= MAX_STATUS {
                return Err(limit("status entries"));
            }
            if self.bytes.fetch_add(path.len() + 128, Ordering::Relaxed) + path.len() + 128
                > MAX_BYTES
            {
                return Err(limit("batch result bytes"));
            }
        }
        apply_item(&mut self.files, path.clone(), item)?;
        if let Some(source) = self
            .files
            .get(&path)
            .and_then(|file| file.renamed_from.as_ref())
        {
            if source.len() > MAX_PATH {
                return Err(limit("rename source length"));
            }
            if self.bytes.fetch_add(source.len(), Ordering::Relaxed) + source.len() > MAX_BYTES {
                return Err(limit("batch result bytes"));
            }
        }
        Ok(())
    }
}

impl<'index> gix::status::plumbing::index_as_worktree_with_renames::VisitEntry<'index>
    for Collector<'_>
{
    type ContentChange = ();
    type SubmoduleStatus = gix::submodule::Status;
    fn visit_entry(
        &mut self,
        entry: gix::status::plumbing::index_as_worktree_with_renames::Entry<
            'index,
            (),
            Self::SubmoduleStatus,
        >,
    ) {
        self.add(gix::status::Item::IndexWorktree(entry.into()));
        // Errors stop collection, not sibling repositories. Low-level work is
        // joined before return; external cancellation still interrupts its loops.
    }
}
pub(super) struct StatusOutput {
    pub(super) files: Vec<FileStatus>,
    pub(super) first_change: Option<gix::status::Item>,
}
pub(super) fn status(
    repo: &mut gix::Repository,
    ignored: bool,
    token: &CancellationToken,
    bytes: &AtomicUsize,
    modules: &AtomicUsize,
    depth: usize,
    ignore_untracked: bool,
) -> Result<StatusOutput, GitReadError> {
    check(token)?;
    if depth > 8 {
        return Err(limit("submodule depth"));
    }
    let external_filters = prepare_read_options(repo)?;
    let index = repo
        .index_or_empty()
        .map_err(|e| GitReadError::from_gix("read index", e))?;
    if index.entries().len() > MAX_ENTRIES {
        return Err(limit("index entries"));
    }
    guard_external_filters(repo, &index, &external_filters, token)?;
    // Compute children sequentially before parent producer threads are started.
    let submodules = submodule_statuses(repo, &index, token, bytes, modules, depth)?;
    let mut collector = Collector {
        files: BTreeMap::new(),
        error: None,
        first_change: None,
        token,
        bytes,
    };
    let tree = repo
        .head_tree_id_or_empty()
        .map_err(|e| GitReadError::from_gix("read HEAD tree", e))?;
    // The implicit tree/index pathspec matches only the process cwd prefix.
    // Project snapshots always cover the entire repository, like worktree status.
    let mut pathspec = repo
        .pathspec(
            false,
            None::<&str>,
            false,
            &index,
            gix::worktree::stack::state::attributes::Source::IdMapping,
        )
        .map_err(|e| GitReadError::from_gix("prepare repository-wide status pathspec", e))?;
    repo.tree_index_status(
        &tree,
        &index,
        Some(&mut pathspec),
        gix::status::tree_index::TrackRenames::AsConfigured,
        |change, _, _| {
            collector.add(gix::status::Item::TreeIndex(change.into_owned()));
            if collector.error.is_some() || token.is_cancelled() {
                Ok::<_, std::convert::Infallible>(std::ops::ControlFlow::Break(()))
            } else {
                Ok(std::ops::ControlFlow::Continue(()))
            }
        },
    )
    .map_err(|e| GitReadError::from_gix("tree index status", e))?;
    if let Some(error) = collector.error.take() {
        return Err(error);
    }
    check(token)?;
    let mut dirwalk = repo
        .dirwalk_options()
        .map_err(|e| GitReadError::from_gix("status options", e))?;
    if ignored {
        dirwalk.set_emit_ignored(Some(gix::dir::walk::EmissionMode::Matching));
    }
    let untracked = repo
        .config_snapshot()
        .string("status.showUntrackedFiles")
        .map(|v| v.to_string());
    if untracked.as_deref() == Some("all") {
        dirwalk.set_emit_untracked(gix::dir::walk::EmissionMode::Matching);
    }
    let interrupt = token.owned_flag();
    let result = repo.index_worktree_status(
        &index,
        Vec::<gix::bstr::BString>::new(),
        &mut collector,
        gix::status::plumbing::index_as_worktree::traits::FastEq,
        submodules,
        &mut gix::progress::Discard,
        &interrupt,
        gix::status::index_worktree::Options {
            sorting: None,
            dirwalk_options: if ignore_untracked || untracked.as_deref() == Some("no") {
                None
            } else {
                Some(dirwalk)
            },
            rewrites: None,
            thread_limit: Some(1),
        },
    );
    if let Some(error) = collector.error {
        return Err(error);
    }
    check(token)?;
    result.map_err(|e| GitReadError::from_gix("worktree status", e))?;
    // Detect newly selected external filters too. Their definitions were removed
    // from the in-memory read view, so an attributes race can never launch one.
    guard_external_filters(repo, &index, &external_filters, token)?;
    Ok(StatusOutput {
        files: collector.files.into_values().collect(),
        first_change: collector.first_change,
    })
}

fn apply_item(
    files: &mut BTreeMap<String, FileStatus>,
    path: String,
    item: gix::status::Item,
) -> Result<(), GitReadError> {
    let status = files.entry(path.clone()).or_insert_with(|| FileStatus {
        path,
        index: " ".into(),
        worktree: " ".into(),
        ..FileStatus::default()
    });
    match item {
        gix::status::Item::TreeIndex(change) => {
            use gix::diff::index::ChangeRef;
            status.index = match &change {
                ChangeRef::Addition { .. } => "A",
                ChangeRef::Deletion { .. } => "D",
                ChangeRef::Modification { .. } => "M",
                ChangeRef::Rewrite {
                    source_location,
                    copy,
                    ..
                } => {
                    status.renamed_from = Some(path_text(source_location)?);
                    if *copy { "C" } else { "R" }
                }
            }
            .into();
        }
        gix::status::Item::IndexWorktree(change) => {
            if let gix::status::index_worktree::Item::DirectoryContents { entry, .. } = &change {
                match entry.status {
                    gix::dir::entry::Status::Ignored(_) => {
                        status.index = "!".into();
                        status.worktree = "!".into();
                        status.ignored = true;
                        return Ok(());
                    }
                    gix::dir::entry::Status::Untracked => {
                        status.index = "?".into();
                        status.worktree = "?".into();
                        status.untracked = true;
                        return Ok(());
                    }
                    _ => {}
                }
            }
            if let gix::status::index_worktree::Item::Rewrite { source, copy, .. } = &change {
                status.renamed_from = Some(path_text(source.rela_path())?);
                status.worktree = if *copy { "C" } else { "R" }.into();
                return Ok(());
            }
            status.worktree = match change.summary() {
                Some(gix::status::index_worktree::iter::Summary::Removed) => "D",
                Some(gix::status::index_worktree::iter::Summary::Added) => "?",
                Some(gix::status::index_worktree::iter::Summary::Renamed) => "R",
                Some(gix::status::index_worktree::iter::Summary::Copied) => "C",
                Some(gix::status::index_worktree::iter::Summary::Conflict) => "U",
                Some(gix::status::index_worktree::iter::Summary::Modified)
                | Some(gix::status::index_worktree::iter::Summary::TypeChange)
                | Some(gix::status::index_worktree::iter::Summary::IntentToAdd) => "M",
                None => " ",
            }
            .into();
            status.untracked = status.worktree == "?";
            if status.untracked {
                status.index = "?".into();
            }
        }
    }
    Ok(())
}
fn path_text(path: &gix::bstr::BStr) -> Result<String, GitReadError> {
    use gix::bstr::ByteSlice;
    path.to_str()
        .map(ToOwned::to_owned)
        .map_err(|_| GitReadError::new(ErrorKind::Unsupported, "non-UTF-8 status path"))
}

pub(crate) struct Operation {
    pub(crate) token: Arc<CancellationToken>,
    started: std::sync::atomic::AtomicBool,
    _permit: ActivePermit<'static>,
}
fn operations() -> &'static crate::core::registry::HandleRegistry<Operation> {
    static REGISTRY: std::sync::OnceLock<crate::core::registry::HandleRegistry<Operation>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(crate::core::registry::HandleRegistry::new)
}
pub(crate) fn create_operation() -> Result<u32, ErrorDetail> {
    let permit = admit()?;
    Ok(operations().insert(Arc::new(Operation {
        token: Arc::new(CancellationToken::default()),
        started: std::sync::atomic::AtomicBool::new(false),
        _permit: permit,
    })))
}
pub(crate) fn start_operation(id: u32) -> Result<Arc<Operation>, ErrorDetail> {
    let operation = operations()
        .get(id)
        .ok_or_else(|| ErrorDetail::new(ErrorKind::InvalidInput, "unknown Git operation", false))?;
    if operation.started.swap(true, Ordering::AcqRel) {
        return Err(ErrorDetail::new(
            ErrorKind::InvalidInput,
            "Git operation already started",
            false,
        ));
    }
    Ok(operation)
}
pub(crate) fn cancel_operation(id: u32) {
    if let Some(operation) = operations().get(id) {
        operation.token.cancel();
    }
}
pub(crate) fn close_operation(id: u32) {
    if let Some(operation) = operations().remove(id) {
        operation.token.cancel();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    static SEQUENCE: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    use std::path::PathBuf;
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "nerve-git-project-{}-{}",
                std::process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn repo(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            std::fs::create_dir_all(&path).unwrap();
            git(&path, &["init", "--initial-branch=main"]);
            git(&path, &["config", "user.name", "Synthetic"]);
            git(
                &path,
                &["config", "user.email", "synthetic@example.invalid"],
            );
            std::fs::write(path.join("tracked.txt"), "base\n").unwrap();
            std::fs::write(path.join(".gitignore"), "*.ignored\n").unwrap();
            git(&path, &["add", "."]);
            git(&path, &["commit", "-qm", "initial"]);
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn git_output(path: &Path, args: &[&str]) -> std::process::Output {
        let isolation = Fixture::new();
        let empty = isolation.0.join("empty");
        std::fs::create_dir(&empty).unwrap();
        let config = isolation.0.join("config");
        std::fs::write(&config, "").unwrap();
        let mut command = Command::new("git");
        command
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default());
        if let Some(system_root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", system_root);
        }
        command
            .args([
                "-c",
                &format!("core.hooksPath={}", empty.display()),
                "-c",
                &format!("core.attributesFile={}", config.display()),
                "-c",
                "commit.gpgSign=false",
                "-c",
                "tag.gpgSign=false",
                "-c",
                "credential.helper=",
            ])
            .args(args)
            .current_dir(path)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_SYSTEM", &config)
            .env("GIT_CONFIG_GLOBAL", &config)
            .env("GIT_TEMPLATE_DIR", &empty)
            .env("GIT_ATTR_NOSYSTEM", "1")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .unwrap()
    }
    fn git(path: &Path, args: &[&str]) {
        let output = git_output(path, args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    #[test]
    fn root_metadata_path_bound_is_not_downgraded_to_non_repository() {
        let fixture = Fixture::new();
        fixture.repo(".");
        let root = fixture.0.canonicalize().unwrap();
        let error = discover_with_path_limit(
            root.to_str().unwrap(),
            &CancellationToken::default(),
            root.to_str().unwrap().len() + 4,
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::LimitExceeded);
    }
    #[test]
    fn discovery_preserves_depth_exclusions_and_root_short_circuit() {
        let fixture = Fixture::new();
        fixture.repo("a/b/c");
        fixture.repo("too/deep/for/discovery");
        fixture.repo("node_modules/hidden");
        fixture.repo(".hidden");
        let token = CancellationToken::default();
        let found = discover(fixture.0.to_str().unwrap(), &token).unwrap();
        assert!(!found.project_is_repo);
        assert_eq!(found.repositories.len(), 1);
        assert_eq!(found.repositories[0].relative_path, "a/b/c");
        fixture.repo(".");
        let found = discover(fixture.0.to_str().unwrap(), &token).unwrap();
        assert!(found.project_is_repo);
        assert_eq!(found.repositories.len(), 1);
        assert_eq!(found.repositories[0].relative_path, ".");
    }
    #[cfg(unix)]
    #[test]
    fn discovery_does_not_follow_directory_symlinks() {
        let fixture = Fixture::new();
        let outside = Fixture::new();
        outside.repo("outside");
        std::os::unix::fs::symlink(&outside.0, fixture.0.join("escape")).unwrap();
        assert!(
            discover(fixture.0.to_str().unwrap(), &CancellationToken::default())
                .unwrap()
                .repositories
                .is_empty()
        );
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_project_root_uses_canonical_identity_without_relaxing_containment() {
        let fixture = Fixture::new();
        let repository = fixture.repo("real/repo");
        let outside = fixture.repo("real-sibling");
        let alias = fixture.0.join("alias");
        std::os::unix::fs::symlink(fixture.0.join("real"), &alias).unwrap();
        assert_ne!(alias, alias.canonicalize().unwrap());

        let descriptor = identity(&alias, &alias.join("repo")).unwrap();
        assert_eq!(descriptor.relative_path, "repo");
        assert_eq!(
            Path::new(&descriptor.work_dir),
            repository.canonicalize().unwrap()
        );
        let found = discover(alias.to_str().unwrap(), &CancellationToken::default()).unwrap();
        assert_eq!(Path::new(&found.root), alias.canonicalize().unwrap());
        assert_eq!(found.repositories.len(), 1);
        assert_eq!(found.repositories[0].work_dir, descriptor.work_dir);
        assert_eq!(found.repositories[0].git_dir, descriptor.git_dir);
        assert_eq!(found.repositories[0].common_dir, descriptor.common_dir);
        // A sibling sharing the textual prefix is still outside the project.
        assert_eq!(
            identity(&alias, &outside).unwrap_err().kind,
            ErrorKind::InvalidInput
        );
    }
    #[test]
    fn linked_worktrees_have_distinct_git_dirs_and_shared_common_dir() {
        let fixture = Fixture::new();
        let main = fixture.repo("main");
        let linked = fixture.0.join("linked");
        git(
            &main,
            &["worktree", "add", "-b", "linked", linked.to_str().unwrap()],
        );
        let found = discover(fixture.0.to_str().unwrap(), &CancellationToken::default()).unwrap();
        assert_eq!(found.repositories.len(), 2);
        assert_ne!(found.repositories[0].git_dir, found.repositories[1].git_dir);
        assert_eq!(
            found.repositories[0].common_dir,
            found.repositories[1].common_dir
        );
        assert!(Path::new(&found.repositories[0].common_dir).is_absolute());
    }
    #[test]
    fn lightweight_status_matches_existing_snapshot_and_reports_progress() {
        let fixture = Fixture::new();
        let path = fixture.repo("repo");
        std::fs::write(path.join("tracked.txt"), "changed\n").unwrap();
        std::fs::write(path.join("new.txt"), "new\n").unwrap();
        std::fs::write(path.join("x.ignored"), "ignored\n").unwrap();
        git(&path, &["add", "tracked.txt"]);
        std::fs::write(path.join("tracked.txt"), "changed again\n").unwrap();
        let token = Arc::new(CancellationToken::default());
        let found = discover(fixture.0.to_str().unwrap(), &token).unwrap();
        let legacy = super::super::read_snapshot(
            path.to_str().unwrap(),
            super::super::SnapshotOptions {
                include_ignored: true,
                ..Default::default()
            },
        )
        .unwrap();
        let results = snapshots(found.repositories, true, token).unwrap();
        let observed = results.into_iter().next().unwrap().snapshot.unwrap();
        let digest = |files: Vec<FileStatus>| {
            files
                .into_iter()
                .map(|f| {
                    (
                        f.path,
                        f.index,
                        f.worktree,
                        f.untracked,
                        f.ignored,
                        f.renamed_from,
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(digest(observed.files), digest(legacy.files));
        assert_eq!(observed.counts.staged, 1);
        assert_eq!(observed.counts.unstaged, 1);
        assert_eq!(observed.counts.untracked, 1);
        assert_eq!(observed.counts.ignored, 1);
        std::fs::write(path.join(".git/MERGE_HEAD"), "synthetic marker\n").unwrap();
        let descriptor = identity(&fixture.0, &path).unwrap();
        let snapshot = snapshot(
            &descriptor,
            true,
            &CancellationToken::default(),
            &AtomicUsize::new(0),
        )
        .unwrap();
        assert_eq!(snapshot.in_progress, vec!["merge"]);
    }
    #[test]
    fn staged_status_includes_paths_outside_process_cwd() {
        const CHILD_REPO: &str = "NERVE_GIT_STAGED_CWD_TEST_REPO";
        if let Some(path) = std::env::var_os(CHILD_REPO) {
            let path = PathBuf::from(path);
            let descriptor = identity(&path, &path).unwrap();
            let index_before = std::fs::read(path.join(".git/index")).unwrap();
            let observed = snapshot(
                &descriptor,
                false,
                &CancellationToken::default(),
                &AtomicUsize::new(0),
            )
            .unwrap();
            assert_eq!(observed.counts.staged, 3);
            assert_eq!(observed.counts.unstaged, 0);
            assert_eq!(
                observed
                    .files
                    .iter()
                    .map(|file| (
                        file.path.as_str(),
                        file.index.as_str(),
                        file.worktree.as_str()
                    ))
                    .collect::<Vec<_>>(),
                vec![
                    ("nested/inside.txt", "A", " "),
                    ("sibling.txt", "A", " "),
                    ("tracked.txt", "M", " "),
                ]
            );
            let legacy = super::super::read_snapshot(
                path.to_str().unwrap(),
                super::super::SnapshotOptions::default(),
            )
            .unwrap();
            let digest = |files: &[FileStatus]| {
                files
                    .iter()
                    .map(|file| (file.path.clone(), file.index.clone(), file.worktree.clone()))
                    .collect::<Vec<_>>()
            };
            assert_eq!(digest(&legacy.files), digest(&observed.files));
            assert_eq!(
                std::fs::read(path.join(".git/index")).unwrap(),
                index_before
            );

            // A staged file can become mixed and then staged-only again without
            // losing the repository-wide index changes between snapshots.
            let tracked = path.join("tracked.txt");
            let mut contents = std::fs::read_to_string(&tracked).unwrap();
            contents.push_str("changed again\n");
            std::fs::write(tracked, contents).unwrap();
            let read = || {
                snapshot(
                    &descriptor,
                    false,
                    &CancellationToken::default(),
                    &AtomicUsize::new(0),
                )
                .unwrap()
            };
            let mixed = read();
            assert_eq!((mixed.counts.staged, mixed.counts.unstaged), (3, 1));
            git(&path, &["add", "tracked.txt"]);
            let staged = read();
            assert_eq!((staged.counts.staged, staged.counts.unstaged), (3, 0));
            return;
        }
        let fixture = Fixture::new();
        let path = fixture.repo("repo");
        let nested = path.join("nested");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(path.join("tracked.txt"), "changed\n").unwrap();
        std::fs::write(path.join("sibling.txt"), "added\n").unwrap();
        std::fs::write(nested.join("inside.txt"), "added\n").unwrap();
        git(&path, &["add", "."]);
        // Isolate process cwd in a child so parallel unit tests are unaffected.
        for cwd in [&nested, &fixture.0, &path] {
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "git::project::tests::staged_status_includes_paths_outside_process_cwd",
                    "--nocapture",
                ])
                .current_dir(cwd)
                .env(CHILD_REPO, &path)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "cwd: {}\nstdout: {}\nstderr: {}",
                cwd.display(),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                String::from_utf8_lossy(&output.stdout).contains("1 passed; 0 failed"),
                "child must execute the exact regression test, not match zero tests"
            );
        }
    }
    #[test]
    fn repository_errors_are_independent_and_inputs_are_bounded() {
        let fixture = Fixture::new();
        let path = fixture.repo("good");
        let good = identity(&fixture.0, &path).unwrap();
        let mut bad = good.clone();
        bad.work_dir = fixture.0.join("missing").to_str().unwrap().into();
        let results = snapshots(
            vec![bad, good.clone()],
            false,
            Arc::new(CancellationToken::default()),
        )
        .unwrap();
        assert!(results[0].snapshot.is_err());
        assert!(results[1].snapshot.is_ok());
        assert_eq!(
            snapshots(
                vec![good; 129],
                false,
                Arc::new(CancellationToken::default())
            )
            .unwrap_err()
            .kind,
            ErrorKind::LimitExceeded
        );
    }
    #[test]
    fn cancelled_reads_and_output_overflow_never_return_partial_success() {
        let fixture = Fixture::new();
        let path = fixture.repo("repo");
        let repository = identity(&fixture.0, &path).unwrap();
        let token = CancellationToken::default();
        let flag = token.owned_flag();
        token.cancel();
        assert!(flag.load(Ordering::Acquire));
        assert_eq!(
            discover(fixture.0.to_str().unwrap(), &token)
                .unwrap_err()
                .kind,
            ErrorKind::Cancelled
        );
        let bytes = AtomicUsize::new(MAX_BYTES);
        std::fs::write(path.join("new.txt"), "untracked\n").unwrap();
        assert_eq!(
            snapshot(&repository, false, &CancellationToken::default(), &bytes)
                .unwrap_err()
                .kind,
            ErrorKind::LimitExceeded
        );
    }
    #[test]
    fn unused_filter_config_is_supported_but_selected_external_filters_fail_explicitly() {
        let fixture = Fixture::new();
        let path = fixture.repo("repo");
        let descriptor = identity(&fixture.0, &path).unwrap();
        git(
            &path,
            &["config", "filter.synthetic.clean", "must-not-execute"],
        );
        git(&path, &["config", "filter.synthetic.required", "true"]);
        assert!(
            snapshot(
                &descriptor,
                false,
                &CancellationToken::default(),
                &AtomicUsize::new(0)
            )
            .unwrap()
            .files
            .is_empty()
        );
        std::fs::write(
            path.join(".gitattributes"),
            "tracked.txt filter=synthetic\n",
        )
        .unwrap();
        let isolation = detail(
            snapshot(
                &descriptor,
                false,
                &CancellationToken::default(),
                &AtomicUsize::new(0),
            )
            .unwrap_err(),
        );
        assert_eq!(isolation.category, ErrorKind::IsolationRequired);
        assert_eq!(isolation.category.as_str(), "isolation_required");
        assert!(!isolation.retryable);
        // Config was edited only in-memory; no driver definitions were removed on disk.
        assert!(
            String::from_utf8(git_output(&path, &["config", "filter.synthetic.clean"]).stdout)
                .unwrap()
                .contains("must-not-execute")
        );
    }
    fn assert_status_parity(fixture: &Fixture, path: &Path) -> Vec<FileStatus> {
        let descriptor = identity(&fixture.0, path).unwrap();
        let observed = snapshot(
            &descriptor,
            false,
            &CancellationToken::default(),
            &AtomicUsize::new(0),
        )
        .unwrap();
        let legacy = super::super::read_snapshot(
            path.to_str().unwrap(),
            super::super::SnapshotOptions::default(),
        )
        .unwrap();
        let digest = |files: &[FileStatus]| {
            files
                .iter()
                .map(|f| (&f.path, &f.index, &f.worktree, f.untracked, f.ignored))
                .map(|(p, i, w, u, g)| (p.clone(), i.clone(), w.clone(), u, g))
                .collect::<Vec<_>>()
        };
        assert_eq!(digest(&observed.files), digest(&legacy.files));
        observed.files
    }
    #[test]
    fn staged_gitlinks_without_module_config_are_not_rejected() {
        let fixture = Fixture::new();
        let path = fixture.repo("repo");
        let oid = String::from_utf8(git_output(&path, &["rev-parse", "HEAD"]).stdout).unwrap();
        git(
            &path,
            &[
                "update-index",
                "--add",
                "--cacheinfo",
                &format!("160000,{},submodule", oid.trim()),
            ],
        );
        assert!(
            assert_status_parity(&fixture, &path)
                .iter()
                .any(|file| file.path == "submodule" && file.index == "A")
        );
    }
    #[test]
    fn submodule_dirty_untracked_head_staging_ignore_and_uninitialized_parity() {
        let fixture = Fixture::new();
        let source = fixture.repo("source");
        let parent = fixture.repo("parent");
        git(
            &parent,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                source.to_str().unwrap(),
                "child",
            ],
        );
        git(&parent, &["commit", "-am", "add child"]);
        assert!(assert_status_parity(&fixture, &parent).is_empty());
        let child = parent.join("child");
        std::fs::write(child.join("tracked.txt"), "dirty\n").unwrap();
        assert!(
            assert_status_parity(&fixture, &parent)
                .iter()
                .any(|f| f.path == "child" && f.worktree == "M")
        );
        std::fs::write(child.join("tracked.txt"), "base\n").unwrap();
        std::fs::write(child.join("untracked.txt"), "new\n").unwrap();
        assert!(
            assert_status_parity(&fixture, &parent)
                .iter()
                .any(|f| f.path == "child" && f.worktree == "M")
        );
        git(&parent, &["config", "submodule.child.ignore", "untracked"]);
        assert!(assert_status_parity(&fixture, &parent).is_empty());
        git(
            &child,
            &[
                "-c",
                "user.name=Synthetic",
                "-c",
                "user.email=synthetic@example.invalid",
                "commit",
                "--allow-empty",
                "-qm",
                "ahead",
            ],
        );
        git(&parent, &["config", "submodule.child.ignore", "dirty"]);
        assert!(
            assert_status_parity(&fixture, &parent)
                .iter()
                .any(|f| f.path == "child" && f.worktree == "M")
        );
        git(&parent, &["add", "child"]);
        assert!(
            assert_status_parity(&fixture, &parent)
                .iter()
                .any(|f| f.path == "child" && f.index == "M" && f.worktree == " ")
        );
        git(&parent, &["config", "submodule.child.ignore", "all"]);
        assert_status_parity(&fixture, &parent);
        git(&parent, &["submodule", "deinit", "-f", "child"]);
        assert_status_parity(&fixture, &parent);
    }
    #[test]
    fn nested_submodule_dirtiness_uses_same_joined_reader_and_explicit_budget() {
        let fixture = Fixture::new();
        let grand = fixture.repo("grand-source");
        let source = fixture.repo("source");
        git(
            &source,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                grand.to_str().unwrap(),
                "grand",
            ],
        );
        git(&source, &["commit", "-am", "nested"]);
        let parent = fixture.repo("parent");
        git(
            &parent,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "add",
                source.to_str().unwrap(),
                "child",
            ],
        );
        git(
            &parent,
            &[
                "-c",
                "protocol.file.allow=always",
                "submodule",
                "update",
                "--init",
                "--recursive",
            ],
        );
        git(&parent, &["commit", "-am", "child"]);
        assert!(assert_status_parity(&fixture, &parent).is_empty());
        std::fs::write(parent.join("child/grand/tracked.txt"), "nested dirty\n").unwrap();
        assert!(
            assert_status_parity(&fixture, &parent)
                .iter()
                .any(|f| f.path == "child" && f.worktree == "M")
        );
        let descriptor = identity(&fixture.0, &parent).unwrap();
        let error = snapshot_with_modules(
            &descriptor,
            false,
            &CancellationToken::default(),
            &AtomicUsize::new(0),
            &AtomicUsize::new(128),
        )
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::LimitExceeded);
    }
    #[test]
    fn detailed_and_project_snapshots_share_operation_state() {
        let fixture = Fixture::new();
        let path = fixture.repo("repo");
        let descriptor = identity(&fixture.0, &path).unwrap();
        for marker in [
            "MERGE_HEAD",
            "CHERRY_PICK_HEAD",
            "REVERT_HEAD",
            "BISECT_LOG",
        ] {
            std::fs::write(path.join(".git").join(marker), "synthetic marker\n").unwrap();
        }
        for marker in ["rebase-merge", "rebase-apply"] {
            std::fs::create_dir(path.join(".git").join(marker)).unwrap();
        }
        let detailed = super::super::read_snapshot(
            path.to_str().unwrap(),
            super::super::SnapshotOptions::default(),
        )
        .unwrap();
        let light = snapshot(
            &descriptor,
            false,
            &CancellationToken::default(),
            &AtomicUsize::new(0),
        )
        .unwrap();
        assert_eq!(
            detailed.in_progress,
            vec!["merge", "rebase", "cherry_pick", "revert", "bisect"]
        );
        assert_eq!(detailed.in_progress, light.in_progress);
    }
    #[test]
    fn upstream_and_staged_rename_match_full_snapshot() {
        let fixture = Fixture::new();
        let path = fixture.repo("repo");
        git(&path, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
        git(
            &path,
            &[
                "config",
                "remote.origin.url",
                fixture.0.join("local-remote.git").to_str().unwrap(),
            ],
        );
        git(
            &path,
            &[
                "config",
                "remote.origin.fetch",
                "+refs/heads/*:refs/remotes/origin/*",
            ],
        );
        git(&path, &["config", "branch.main.remote", "origin"]);
        git(&path, &["config", "branch.main.merge", "refs/heads/main"]);
        git(&path, &["mv", "tracked.txt", "renamed.txt"]);
        git(&path, &["commit", "-qm", "rename"]);
        std::fs::rename(path.join("renamed.txt"), path.join("again.txt")).unwrap();
        git(&path, &["add", "-A"]);
        let descriptor = identity(&fixture.0, &path).unwrap();
        let observed = snapshot(
            &descriptor,
            false,
            &CancellationToken::default(),
            &AtomicUsize::new(0),
        )
        .unwrap();
        assert_eq!(observed.branch.as_deref(), Some("main"));
        assert_eq!(observed.upstream.as_deref(), Some("origin/main"));
        assert_eq!(observed.ahead, Some(1));
        assert_eq!(observed.behind, Some(0));
        assert!(!observed.detached);
        assert!(observed.head_oid.is_some());
        assert_eq!(observed.files.len(), 1);
        assert_eq!(
            observed.files[0].renamed_from.as_deref(),
            Some("renamed.txt")
        );
        assert_eq!(observed.files[0].index, "R");
    }
    #[test]
    fn admission_is_held_by_in_flight_operation_after_close() {
        let _lock = super::super::test_support::admission_lock();
        let a = create_operation().unwrap();
        let b = create_operation().unwrap();
        let in_flight = start_operation(a).unwrap();
        close_operation(a);
        assert!(in_flight.token.is_cancelled());
        assert!(create_operation().is_err());
        assert!(start_operation(a).is_err());
        drop(in_flight);
        let c = create_operation().unwrap();
        close_operation(b);
        close_operation(c);
    }
}
