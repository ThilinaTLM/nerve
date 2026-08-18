use std::collections::BTreeMap;
use std::path::Path;

use gix::bstr::{BStr, ByteSlice};

use super::error::{ErrorKind, GitReadError};
use super::model::{
    FileStatus, RecentCommit, Reference, Remote, RepositoryInfo, Snapshot, SnapshotOptions, Stash,
};

pub fn read_info(path: &str) -> Result<RepositoryInfo, GitReadError> {
    let repo = gix::open(Path::new(path))
        .map_err(|error| GitReadError::from_gix("open repository", error))?;
    Ok(RepositoryInfo {
        git_dir: repo.git_dir().to_string_lossy().into_owned(),
        work_dir: repo
            .workdir()
            .map(|path| path.to_string_lossy().into_owned()),
        bare: repo.is_bare(),
    })
}

pub fn read_snapshot(path: &str, options: SnapshotOptions) -> Result<Snapshot, GitReadError> {
    let mut repo = gix::open(Path::new(path))
        .map_err(|error| GitReadError::from_gix("open repository", error))?;
    if repo.workdir().is_none() {
        return Err(GitReadError::new(
            ErrorKind::Unsupported,
            "bare repositories do not have a worktree snapshot",
        ));
    }
    repo.object_cache_size_if_unset(4 * 1024 * 1024);

    let head = repo
        .head()
        .map_err(|error| GitReadError::from_gix("read HEAD", error))?;
    let head_oid = head.id().map(|id| id.to_string());
    let head_branch = head
        .referent_name()
        .map(|name| name.shorten().to_str_lossy().into_owned());
    let detached = head_branch.is_none() && head_oid.is_some();
    let upstream = match repo
        .head_ref()
        .map_err(|error| GitReadError::from_gix("read HEAD reference", error))?
        .and_then(|reference| reference.remote_tracking_ref_name(gix::remote::Direction::Fetch))
    {
        Some(Ok(name)) => Some(name.shorten().to_str_lossy().into_owned()),
        Some(Err(error)) => {
            return Err(GitReadError::from_gix("read HEAD upstream", error));
        }
        None => None,
    };
    let (ahead, behind) = match (head_oid.as_deref(), upstream.as_deref()) {
        (Some(head), Some(upstream)) => ahead_behind(&repo, head, upstream)?,
        _ => (None, None),
    };

    let refs = read_refs(&repo, options.ref_limit)?;
    let remotes = read_remotes(&repo)?;
    let files = read_status(&repo, options.include_ignored, options.status_limit)?;
    let recent_commits = read_recent_commits(&repo, options.recent_commit_limit)?;
    let stashes = read_stashes(&repo, options.stash_limit)?;

    Ok(Snapshot {
        git_dir: repo.git_dir().to_string_lossy().into_owned(),
        work_dir: repo
            .workdir()
            .map(|path| path.to_string_lossy().into_owned()),
        head_oid,
        head_branch,
        detached,
        upstream,
        ahead,
        behind,
        refs,
        remotes,
        files,
        recent_commits,
        stashes,
    })
}

fn read_refs(repo: &gix::Repository, limit: usize) -> Result<Vec<Reference>, GitReadError> {
    let platform = repo
        .references()
        .map_err(|error| GitReadError::from_gix("open references", error))?;
    let iterator = platform
        .all()
        .map_err(|error| GitReadError::from_gix("iterate references", error))?;
    let mut refs = Vec::new();
    for item in iterator {
        if refs.len() >= limit {
            return Err(GitReadError::new(
                ErrorKind::LimitExceeded,
                format!("reference count exceeds {limit}"),
            ));
        }
        let reference = item.map_err(|error| GitReadError::from_gix("read reference", error))?;
        let upstream = match reference.remote_tracking_ref_name(gix::remote::Direction::Fetch) {
            Some(Ok(name)) => Some(name.shorten().to_str_lossy().into_owned()),
            Some(Err(error)) => {
                return Err(GitReadError::from_gix("read branch upstream", error));
            }
            None => None,
        };
        let (target, symbolic_target) = match reference.target() {
            gix::refs::TargetRef::Object(id) => (Some(id.to_string()), None),
            gix::refs::TargetRef::Symbolic(name) => {
                (None, Some(name.as_bstr().to_str_lossy().into_owned()))
            }
        };
        refs.push(Reference {
            name: reference.name().as_bstr().to_str_lossy().into_owned(),
            target,
            symbolic_target,
            upstream,
        });
    }
    refs.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(refs)
}

fn read_remotes(repo: &gix::Repository) -> Result<Vec<Remote>, GitReadError> {
    let mut remotes = Vec::new();
    for name in repo.remote_names() {
        let name_text = name.to_str_lossy().into_owned();
        let remote = repo
            .find_remote(name.as_bstr())
            .map_err(|error| GitReadError::from_gix("read remote", error))?;
        remotes.push(Remote {
            name: name_text,
            fetch_url: remote
                .url(gix::remote::Direction::Fetch)
                .map(|url| url.to_bstring().to_str_lossy().into_owned()),
            push_url: remote
                .url(gix::remote::Direction::Push)
                .map(|url| url.to_bstring().to_str_lossy().into_owned()),
        });
    }
    remotes.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(remotes)
}

fn read_status(
    repo: &gix::Repository,
    include_ignored: bool,
    limit: usize,
) -> Result<Vec<FileStatus>, GitReadError> {
    let mut platform = repo
        .status(gix::progress::Discard)
        .map_err(|error| GitReadError::from_gix("prepare status", error))?;
    if include_ignored {
        platform.dirwalk_options_mut(|options| {
            options.set_emit_ignored(Some(gix::dir::walk::EmissionMode::Matching));
        });
    }
    let iterator = platform
        .into_iter(Vec::<gix::bstr::BString>::new())
        .map_err(|error| GitReadError::from_gix("start status", error))?;
    let mut files: BTreeMap<String, FileStatus> = BTreeMap::new();
    for item in iterator {
        let item = item.map_err(|error| GitReadError::from_gix("read status", error))?;
        let path = path_text(item.location())?;
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
                if let gix::status::index_worktree::Item::DirectoryContents { entry, .. } = &change
                {
                    match entry.status {
                        gix::dir::entry::Status::Ignored(_) => {
                            status.index = "!".into();
                            status.worktree = "!".into();
                            status.ignored = true;
                            continue;
                        }
                        gix::dir::entry::Status::Untracked => {
                            status.index = "?".into();
                            status.worktree = "?".into();
                            status.untracked = true;
                            continue;
                        }
                        _ => {}
                    }
                }
                if let gix::status::index_worktree::Item::Rewrite { source, copy, .. } = &change {
                    status.renamed_from = Some(path_text(source.rela_path())?);
                    status.worktree = if *copy { "C" } else { "R" }.into();
                    continue;
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
        if files.len() > limit {
            return Err(GitReadError::new(
                ErrorKind::LimitExceeded,
                format!("status entry count exceeds {limit}"),
            ));
        }
    }
    Ok(files.into_values().collect())
}

fn read_recent_commits(
    repo: &gix::Repository,
    limit: usize,
) -> Result<Vec<RecentCommit>, GitReadError> {
    let Some(head) = repo
        .head()
        .map_err(|error| GitReadError::from_gix("read HEAD", error))?
        .id()
    else {
        return Ok(Vec::new());
    };
    let walk = repo
        .rev_walk([head])
        .sorting(gix::revision::walk::Sorting::ByCommitTime(
            gix::traverse::commit::simple::CommitTimeOrder::NewestFirst,
        ))
        .all()
        .map_err(|error| GitReadError::from_gix("start commit walk", error))?;
    let mut commits = Vec::new();
    for info in walk.take(limit) {
        let info = info.map_err(|error| GitReadError::from_gix("walk commits", error))?;
        let object = info
            .object()
            .map_err(|error| GitReadError::from_gix("read commit", error))?;
        let message = object
            .message()
            .map_err(|error| GitReadError::from_gix("decode commit message", error))?;
        commits.push(RecentCommit {
            oid: info.id.to_string(),
            subject: message.summary().to_str_lossy().into_owned(),
            timestamp_seconds: info.commit_time(),
        });
    }
    Ok(commits)
}

fn read_stashes(repo: &gix::Repository, limit: usize) -> Result<Vec<Stash>, GitReadError> {
    let Some(reference) = repo
        .try_find_reference("refs/stash")
        .map_err(|error| GitReadError::from_gix("read stash reference", error))?
    else {
        return Ok(Vec::new());
    };
    let mut platform = reference.log_iter();
    let Some(iterator) = platform
        .rev()
        .map_err(|error| GitReadError::from_gix("open stash reflog", error))?
    else {
        return Ok(Vec::new());
    };
    let mut stashes = Vec::new();
    for (index, line) in iterator.take(limit).enumerate() {
        let line = line.map_err(|error| GitReadError::from_gix("read stash reflog", error))?;
        stashes.push(Stash {
            index: index as u32,
            oid: line.new_oid.to_string(),
            message: line.message.to_str_lossy().into_owned(),
            timestamp_seconds: line.signature.time.seconds,
        });
    }
    Ok(stashes)
}

fn ahead_behind(
    repo: &gix::Repository,
    head: &str,
    upstream: &str,
) -> Result<(Option<u32>, Option<u32>), GitReadError> {
    let head = repo
        .rev_parse_single(head)
        .map_err(|error| GitReadError::from_gix("resolve HEAD", error))?;
    let upstream = repo
        .rev_parse_single(upstream)
        .map_err(|error| GitReadError::from_gix("resolve upstream", error))?;
    let ahead = count_walk(
        repo.rev_walk([head])
            .with_hidden([upstream])
            .all()
            .map_err(|error| GitReadError::from_gix("walk ahead commits", error))?,
        "walk ahead commits",
    )?;
    let behind = count_walk(
        repo.rev_walk([upstream])
            .with_hidden([head])
            .all()
            .map_err(|error| GitReadError::from_gix("walk behind commits", error))?,
        "walk behind commits",
    )?;
    Ok((Some(to_u32(ahead)?), Some(to_u32(behind)?)))
}

fn count_walk(walk: gix::revision::Walk<'_>, context: &str) -> Result<usize, GitReadError> {
    let mut count = 0usize;
    for item in walk {
        item.map_err(|error| GitReadError::from_gix(context, error))?;
        count = count.checked_add(1).ok_or_else(|| {
            GitReadError::new(ErrorKind::LimitExceeded, "commit count exceeds usize")
        })?;
    }
    Ok(count)
}

fn to_u32(value: usize) -> Result<u32, GitReadError> {
    u32::try_from(value)
        .map_err(|_| GitReadError::new(ErrorKind::LimitExceeded, "commit count exceeds u32"))
}

fn path_text(path: &BStr) -> Result<String, GitReadError> {
    path.to_str().map(ToOwned::to_owned).map_err(|_| {
        GitReadError::new(
            ErrorKind::Unsupported,
            "non-UTF-8 repository paths are unsupported by the public contract",
        )
    })
}
