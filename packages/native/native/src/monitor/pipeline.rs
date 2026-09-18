use std::path::PathBuf;
use std::time::Instant;

use super::model::{ChangeNotice, DEFAULT_QUIET, PendingChange};

pub(crate) fn merge_trigger(
    pending: &mut Option<PendingChange>,
    cause: &str,
    path: Option<PathBuf>,
    full: bool,
    now: Instant,
) -> bool {
    let Some(change) = pending else {
        *pending = Some(PendingChange::new(cause.to_string(), path, full, now));
        return false;
    };
    if !change.causes.iter().any(|existing| existing == cause) {
        change.causes.push(cause.to_string());
    }
    if let Some(path) = path
        && !change.paths.contains(&path)
    {
        change.paths.push(path);
    }
    change.full_refresh_required |= full;
    change.quiet_deadline = now + DEFAULT_QUIET;
    true
}

pub(crate) fn is_due(change: &PendingChange, now: Instant) -> bool {
    now >= change.quiet_deadline || now >= change.maximum_deadline
}

pub(crate) fn notice(
    scope_id: String,
    generation: u64,
    change: PendingChange,
    maximum_paths: usize,
) -> ChangeNotice {
    let truncated = change.paths.len() > maximum_paths;
    ChangeNotice {
        scope_id,
        generation,
        causes: change.causes,
        paths: change
            .paths
            .into_iter()
            .take(maximum_paths)
            .map(|path| path.to_string_lossy().into_owned())
            .collect(),
        full_refresh_required: change.full_refresh_required || truncated,
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use super::*;

    #[test]
    fn merges_causes_and_bounds_notice_paths() {
        let now = Instant::now();
        let mut pending = None;
        assert!(!merge_trigger(
            &mut pending,
            "filesystem",
            Some("a".into()),
            false,
            now,
        ));
        assert!(merge_trigger(
            &mut pending,
            "poll",
            Some("b".into()),
            false,
            now + Duration::from_millis(10),
        ));
        let notice = notice("scope".into(), 1, pending.expect("pending"), 1);
        assert_eq!(notice.causes, ["filesystem", "poll"]);
        assert_eq!(notice.paths.len(), 1);
        assert!(notice.full_refresh_required);
    }
}
