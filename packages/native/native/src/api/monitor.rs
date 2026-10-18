//! Cross-domain composition only: neither domain imports the other.
use crate::git::{read_monitor_snapshot, read_repository_info};
use crate::monitor::GitReadPort;
use crate::monitor::napi::{
    NativeMonitorHandle, NativeMonitorNotice, NativeMonitorOptions, create_monitor,
};
use napi::bindgen_prelude::Result;
use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

#[napi]
pub fn create_change_monitor(
    options: Option<NativeMonitorOptions>,
    callback: ThreadsafeFunction<NativeMonitorNotice>,
) -> Result<NativeMonitorHandle> {
    create_monitor(
        options,
        callback,
        GitReadPort {
            directory,
            fingerprint,
        },
    )
}

fn directory(repository: &Path) -> std::result::Result<PathBuf, String> {
    read_repository_info(&repository.to_string_lossy())
        .map(|info| PathBuf::from(info.git_dir))
        .map_err(|error| error.to_string())
}

fn fingerprint(repository: &Path) -> std::result::Result<u64, String> {
    let snapshot =
        read_monitor_snapshot(&repository.to_string_lossy()).map_err(|error| error.to_string())?;
    let mut hasher = DefaultHasher::new();
    format!("{snapshot:?}").hash(&mut hasher);
    Ok(hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_support::{Fixture, write};
    use crate::git::{SnapshotOptions, read_snapshot};
    fn legacy_fingerprint(path: &Path) -> u64 {
        let snapshot = read_snapshot(path.to_str().unwrap(), SnapshotOptions::default()).unwrap();
        assert!(!snapshot.recent_commits.is_empty());
        let mut hasher = DefaultHasher::new();
        format!("{snapshot:?}").hash(&mut hasher);
        hasher.finish()
    }
    #[test]
    fn guarded_fingerprint_preserves_full_schema_order_and_worktree_ref_remote_stash_coverage() {
        let _lock = crate::git::test_support::admission_lock();
        let f = Fixture::new();
        f.commit();
        let mut previous = fingerprint(&f.path).unwrap();
        assert_eq!(previous, legacy_fingerprint(&f.path));
        for action in 0..4 {
            match action {
                0 => write(f.path.join("tracked.txt"), "worktree changed\n"),
                1 => f.git(&["branch", "other"]),
                2 => f.git(&[
                    "remote",
                    "add",
                    "local",
                    f.root.join("local-remote").to_str().unwrap(),
                ]),
                _ => f.git(&["stash", "push", "-qm", "synthetic stash"]),
            }
            let next = fingerprint(&f.path).unwrap();
            assert_ne!(next, previous);
            assert_eq!(next, legacy_fingerprint(&f.path));
            previous = next;
        }
        // Change only reflog text: HEAD, refs, status and remotes stay identical.
        let log = f.path.join(".git/logs/refs/stash");
        write(
            &log,
            std::fs::read_to_string(&log)
                .unwrap()
                .replace("synthetic stash", "different stash"),
        );
        assert_ne!(fingerprint(&f.path).unwrap(), previous);
        assert_eq!(fingerprint(&f.path).unwrap(), legacy_fingerprint(&f.path));
    }
    #[cfg(unix)]
    #[test]
    fn filter_selected_poll_fails_without_executing_a_parent_filter() {
        let _lock = crate::git::test_support::admission_lock();
        let f = Fixture::new();
        f.commit();
        let marker = f.selected_filter();
        assert!(fingerprint(&f.path).is_err());
        assert!(!marker.exists());
    }
}
