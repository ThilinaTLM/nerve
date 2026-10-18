//! Subordinate reads for the project snapshot. No subprocesses or detached work.
use std::collections::BTreeMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::project::{check, io, limit, status};
use super::{ErrorKind, GitReadError};
use crate::core::cancellation::CancellationToken;
use gix::bstr::{BString, ByteSlice};

/// Restrict index decoding in memory, and remove external driver definitions
/// from this read view. Guard selected attributes before/after status; unused
/// global LFS/filter configuration is not itself an unsupported repository.
pub(super) fn prepare_read_options(
    repo: &mut gix::Repository,
) -> Result<Vec<BString>, GitReadError> {
    let external = gix::filter::Pipeline::options(repo)
        .map_err(|e| GitReadError::from_gix("read filter options", e))?
        .drivers
        .into_iter()
        .filter(|driver| driver.clean.is_some() || driver.process.is_some())
        .map(|driver| driver.name)
        .collect();
    let mut config = repo.config_snapshot_mut();
    config
        .set_value(&gix::config::tree::Index::THREADS, "1")
        .map_err(|e| GitReadError::from_gix("bound index decoding threads", e))?;
    let sections: Vec<_> = config
        .sections_and_ids_by_name("filter")
        .into_iter()
        .flatten()
        .map(|(_, id)| id)
        .collect();
    for id in sections {
        config.remove_section_by_id(id);
    }
    config
        .commit()
        .map_err(|e| GitReadError::from_gix("apply in-memory read options", e))?;
    Ok(external)
}

pub(super) fn guard_external_filters(
    repo: &gix::Repository,
    index: &gix::index::State,
    external: &[BString],
    token: &CancellationToken,
) -> Result<(), GitReadError> {
    if external.is_empty() {
        return Ok(());
    }
    let mut attributes = repo
        .attributes_only(
            index,
            gix::worktree::stack::state::attributes::Source::WorktreeThenIdMapping,
        )
        .map_err(|e| GitReadError::from_gix("read filter attributes", e))?;
    let mut outcome = gix::attrs::search::Outcome::default();
    for entry in index.entries() {
        check(token)?;
        if entry.mode != gix::index::entry::Mode::FILE
            && entry.mode != gix::index::entry::Mode::FILE_EXECUTABLE
        {
            continue;
        }
        attributes
            .at_entry(entry.path(index), Some(entry.mode))
            .map_err(io)?
            .matching_attributes(&mut outcome);
        for matched in outcome.iter() {
            if matched.assignment.name.as_str() == "filter"
                && let gix::attrs::StateRef::Value(value) = matched.assignment.state
                && external
                    .iter()
                    .any(|name| name.as_bstr() == value.as_bstr())
            {
                return Err(GitReadError::new(
                    ErrorKind::IsolationRequired,
                    "tracked paths select an external clean/process filter; cancellable native filter execution is not supported",
                ));
            }
        }
    }
    Ok(())
}

/// A precomputed immutable port. gix can clone it into its one tracked-status
/// worker, but lookup never starts another iterator/thread/process.
#[derive(Clone)]
pub(super) struct SubmoduleStatuses(Arc<BTreeMap<BString, gix::submodule::Status>>);
impl gix::status::plumbing::index_as_worktree::traits::SubmoduleStatus for SubmoduleStatuses {
    type Output = gix::submodule::Status;
    type Error = std::convert::Infallible;
    fn status(
        &mut self,
        _entry: &gix::index::Entry,
        path: &gix::bstr::BStr,
    ) -> Result<Option<Self::Output>, Self::Error> {
        Ok(self.0.get(path).cloned())
    }
}

pub(super) fn submodule_statuses(
    repo: &gix::Repository,
    index: &gix::index::State,
    token: &CancellationToken,
    bytes: &AtomicUsize,
    modules: &AtomicUsize,
    depth: usize,
) -> Result<SubmoduleStatuses, GitReadError> {
    let mut result = BTreeMap::new();
    let Some(submodules) = repo
        .submodules()
        .map_err(|e| GitReadError::from_gix("read submodules", e))?
    else {
        return Ok(SubmoduleStatuses(Arc::new(result)));
    };
    let global_ignore = repo
        .config_snapshot()
        .string("diff.ignoreSubmodules")
        .map(|value| gix::submodule::config::Ignore::try_from(value.as_bstr()))
        .transpose()
        .map_err(|()| {
            GitReadError::new(
                ErrorKind::InvalidInput,
                "invalid diff.ignoreSubmodules setting",
            )
        })?;
    let root = repo
        .workdir()
        .ok_or_else(|| GitReadError::new(ErrorKind::Unsupported, "bare repository"))?
        .canonicalize()
        .map_err(io)?;
    for module in submodules {
        check(token)?;
        let path = module
            .path()
            .map_err(|e| GitReadError::from_gix("read submodule path", e))?;
        if !index.entries().iter().any(|entry| {
            entry.mode == gix::index::entry::Mode::COMMIT && entry.path(index) == path.as_bstr()
        }) {
            continue;
        }
        if modules.fetch_add(1, Ordering::Relaxed) >= 128 {
            return Err(limit("submodule reads"));
        }
        let relative =
            std::path::Path::new(path.to_str().map_err(|_| {
                GitReadError::new(ErrorKind::Unsupported, "non-UTF-8 submodule path")
            })?);
        if relative.components().any(|part| {
            matches!(
                part,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        }) {
            return Err(GitReadError::new(
                ErrorKind::InvalidInput,
                "unsafe submodule path",
            ));
        }
        match root.join(relative).canonicalize() {
            Ok(checkout) if !checkout.starts_with(&root) || checkout == root => {
                return Err(GitReadError::new(
                    ErrorKind::InvalidInput,
                    "submodule worktree escaped its parent",
                ));
            }
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(io(error)),
            _ => {}
        }
        let ignore = match global_ignore {
            Some(value) => value,
            None => module
                .ignore()
                .map_err(|e| GitReadError::from_gix("read submodule ignore setting", e))?
                .unwrap_or_default(),
        };
        // These modes only inspect checkout state/index/HEAD, never start a
        // nested status iterator. This preserves gix's metadata semantics.
        let mut observed = module
            .status(
                if ignore == gix::submodule::config::Ignore::All {
                    ignore
                } else {
                    gix::submodule::config::Ignore::Dirty
                },
                false,
            )
            .map_err(|e| GitReadError::from_gix("read submodule metadata", e))?;
        if !matches!(
            ignore,
            gix::submodule::config::Ignore::All | gix::submodule::config::Ignore::Dirty
        ) && observed.state.worktree_checkout
            && observed.state.repository_exists
            && let Some(mut child) = module
                .open()
                .map_err(|e| GitReadError::from_gix("open submodule", e))?
        {
            let child_root = child
                .workdir()
                .ok_or_else(|| GitReadError::new(ErrorKind::Unsupported, "bare submodule"))?
                .canonicalize()
                .map_err(io)?;
            if !child_root.starts_with(&root) || child_root == root {
                return Err(GitReadError::new(
                    ErrorKind::InvalidInput,
                    "submodule worktree escaped its parent",
                ));
            }
            let child_status = status(
                &mut child,
                false,
                token,
                bytes,
                modules,
                depth + 1,
                ignore == gix::submodule::config::Ignore::Untracked,
            )?;
            // Only one real change is needed for the parent dirty bit. No
            // invented marker and no second matching/status implementation.
            observed.changes = Some(child_status.first_change.into_iter().collect());
        }
        if observed.is_dirty() == Some(true) {
            result.insert(path, observed);
        }
    }
    Ok(SubmoduleStatuses(Arc::new(result)))
}
