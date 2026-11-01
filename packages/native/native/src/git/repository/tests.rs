use super::*;
use crate::git::test_support::{Fixture, write};

#[test]
fn metadata_matches_all_detailed_fields_with_requested_history_and_stashes() {
    let f = Fixture::new();
    f.commit();
    f.git(&[
        "remote",
        "add",
        "origin",
        f.root.join("local-remote").to_str().unwrap(),
    ]);
    f.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    f.git(&["branch", "--set-upstream-to=origin/main", "main"]);
    f.git(&[
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
    ]);
    f.git(&["tag", "v1"]);
    write(f.path.join("tracked.txt"), "stash change\n");
    f.git(&["stash", "push", "-qm", "synthetic stash"]);
    write(f.path.join(".git/MERGE_HEAD"), "synthetic marker\n");
    let full = read_snapshot(f.path(), SnapshotOptions::default()).unwrap();
    let metadata = read_metadata(
        f.path(),
        MetadataOptions {
            recent_commit_limit: 10,
            stash_limit: 1000,
            ..Default::default()
        },
        &CancellationToken::default(),
    )
    .unwrap();
    assert!(!metadata.recent_commits.is_empty());
    assert_eq!(metadata.stashes.len(), 1);
    assert_eq!(metadata.upstream.as_deref(), Some("origin/main"));
    assert_eq!((metadata.ahead, metadata.behind), (Some(0), Some(0)));
    assert_eq!(metadata.in_progress, ["merge"]);
    assert!(metadata.refs.iter().any(|r| r.symbolic_target.is_some()));
    assert!(
        metadata
            .refs
            .iter()
            .any(|r| r.commit_timestamp_seconds.is_some())
    );
    assert_eq!(
        format!("{:?}", metadata),
        format!(
            "{:?}",
            MetadataSnapshot {
                git_dir: full.git_dir,
                work_dir: full.work_dir,
                head_oid: full.head_oid,
                head_branch: full.head_branch,
                detached: full.detached,
                upstream: full.upstream,
                ahead: full.ahead,
                behind: full.behind,
                in_progress: full.in_progress,
                refs: full.refs,
                remotes: full.remotes,
                recent_commits: full.recent_commits,
                stashes: full.stashes,
            }
        )
    );
}
#[test]
fn metadata_defaults_skip_status_history_and_stash_work_and_preserve_zero_status_semantics() {
    let f = Fixture::new();
    f.commit();
    write(f.path.join("tracked.txt"), "stash change\n");
    f.git(&["stash", "push", "-qm", "synthetic stash"]);
    let log = f.path.join(".git/logs/refs/stash");
    write(&log, "not a reflog\n");
    assert!(
        read_metadata(
            f.path(),
            MetadataOptions {
                stash_limit: 1,
                ..Default::default()
            },
            &CancellationToken::default()
        )
        .is_err()
    );
    write(f.path.join("tracked.txt"), "dirty\n");
    assert_eq!(
        read_snapshot(
            f.path(),
            SnapshotOptions {
                status_limit: 0,
                ..Default::default()
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::LimitExceeded
    );
    // Metadata must not even decode the index.
    write(f.path.join(".git/index"), "not an index");
    let metadata = read_metadata(
        f.path(),
        MetadataOptions::default(),
        &CancellationToken::default(),
    )
    .unwrap();
    let oid = metadata.head_oid.unwrap();
    std::fs::rename(
        f.path.join(".git/objects").join(&oid[..2]).join(&oid[2..]),
        f.root.join("removed-commit"),
    )
    .unwrap();
    let metadata = read_metadata(
        f.path(),
        MetadataOptions::default(),
        &CancellationToken::default(),
    )
    .unwrap();
    assert!(metadata.recent_commits.is_empty());
    assert!(metadata.stashes.is_empty());
    assert!(
        read_metadata(
            f.path(),
            MetadataOptions {
                recent_commit_limit: 1,
                ..Default::default()
            },
            &CancellationToken::default()
        )
        .is_err()
    );
}
#[test]
fn metadata_preserves_unborn_detached_and_explicit_ref_limit_failures() {
    let f = Fixture::new();
    let metadata = read_metadata(
        f.path(),
        MetadataOptions::default(),
        &CancellationToken::default(),
    )
    .unwrap();
    assert_eq!(metadata.head_branch.as_deref(), Some("main"));
    assert!(metadata.head_oid.is_none());
    assert!(!metadata.detached);
    f.commit();
    assert_eq!(
        read_metadata(
            f.path(),
            MetadataOptions {
                ref_limit: 0,
                ..Default::default()
            },
            &CancellationToken::default()
        )
        .unwrap_err()
        .kind,
        ErrorKind::LimitExceeded
    );
    f.git(&["checkout", "--detach", "-q"]);
    assert!(
        read_metadata(
            f.path(),
            MetadataOptions::default(),
            &CancellationToken::default()
        )
        .unwrap()
        .detached
    );
}
#[test]
fn cancelled_metadata_never_opens_a_repository_or_returns_partial_data() {
    let token = CancellationToken::default();
    token.cancel();
    assert_eq!(
        read_metadata("/missing", MetadataOptions::default(), &token)
            .unwrap_err()
            .kind,
        ErrorKind::Cancelled
    );
}
#[cfg(unix)]
#[test]
fn selected_filter_is_not_executed_by_metadata_or_guarded_monitor() {
    let _lock = crate::git::test_support::admission_lock();
    let f = Fixture::new();
    f.commit();
    let marker = f.selected_filter();
    assert!(
        read_metadata(
            f.path(),
            MetadataOptions::default(),
            &CancellationToken::default()
        )
        .is_ok()
    );
    assert_eq!(
        read_monitor_snapshot(f.path()).unwrap_err().kind,
        ErrorKind::IsolationRequired
    );
    assert!(!marker.exists());
}

#[test]
fn unpublished_counts_commits_not_on_any_remote_ref() {
    let f = Fixture::new();
    f.commit();
    assert_eq!(count_unpublished(f.path(), "origin").unwrap(), 1);
    f.git(&["update-ref", "refs/remotes/origin/main", "HEAD"]);
    f.git(&["switch", "-qc", "feature"]);
    assert_eq!(count_unpublished(f.path(), "origin").unwrap(), 0);
    write(f.path.join("tracked.txt"), "one\n");
    f.git(&["commit", "-qam", "one"]);
    f.git(&["update-ref", "refs/remotes/origin/stacked", "HEAD"]);
    write(f.path.join("tracked.txt"), "two\n");
    f.git(&["commit", "-qam", "two"]);
    write(f.path.join("tracked.txt"), "three\n");
    f.git(&["commit", "-qam", "three"]);
    assert_eq!(count_unpublished(f.path(), "origin").unwrap(), 2);
    assert_eq!(count_unpublished(f.path(), "upstream").unwrap(), 4);
    assert!(count_unpublished(f.path(), "a/b").is_err());
}

#[test]
fn unpublished_is_zero_for_unborn_head() {
    let f = Fixture::new();
    assert_eq!(count_unpublished(f.path(), "origin").unwrap(), 0);
}
