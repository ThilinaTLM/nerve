use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::SyncSender;

use notify::event::{AccessKind, AccessMode};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use super::runtime::Command;

pub(crate) struct WatchBackend {
    watcher: RecommendedWatcher,
}

impl WatchBackend {
    pub fn new(
        commands: SyncSender<Command>,
        queue_overflowed: Arc<AtomicBool>,
    ) -> Result<Self, String> {
        let watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            let Some(command) = filesystem_command(result) else {
                return;
            };
            if commands.try_send(command).is_err() {
                queue_overflowed.store(true, Ordering::Release);
            }
        })
        .map_err(|error| error.to_string())?;
        Ok(Self { watcher })
    }

    pub fn watch(&mut self, path: &Path) -> Result<(), String> {
        self.watcher
            .watch(path, RecursiveMode::NonRecursive)
            .map_err(|error| error.to_string())
    }

    pub fn unwatch(&mut self, path: &Path) -> Result<(), String> {
        self.watcher
            .unwatch(path)
            .map_err(|error| error.to_string())
    }
}

// Opening a handle is not itself a change. Linux reports IN_OPEN without its
// mode, so Open(Any) is also access-only; an explicit write mode remains evidence.
// Unknown access/close modes stay conservative, as do errors and rescan requests.
fn filesystem_command(result: notify::Result<Event>) -> Option<Command> {
    match result {
        Err(error) => Some(Command::Overflow(error.to_string())),
        Ok(event) if event.need_rescan() => Some(Command::Overflow(
            "Filesystem watcher requested a rescan".into(),
        )),
        Ok(event) => match event.kind {
            EventKind::Access(
                AccessKind::Read
                | AccessKind::Open(AccessMode::Any | AccessMode::Read | AccessMode::Execute)
                | AccessKind::Close(AccessMode::Read | AccessMode::Execute),
            ) => None,
            _ => Some(Command::Filesystem(event.paths)),
        },
    }
}

pub(crate) fn canonical_directory(path: PathBuf) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Could not resolve {}: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!(
            "Monitor path is not a directory: {}",
            path.display()
        ));
    }
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, Flag, ModifyKind, RemoveKind, RenameMode};

    #[test]
    fn read_open_and_read_close_events_do_not_enqueue_filesystem_changes() {
        for access in [
            AccessKind::Read,
            AccessKind::Open(AccessMode::Any),
            AccessKind::Open(AccessMode::Read),
            AccessKind::Open(AccessMode::Execute),
            AccessKind::Close(AccessMode::Read),
            AccessKind::Close(AccessMode::Execute),
        ] {
            let event = Event::new(EventKind::Access(access)).add_path("read-path".into());
            assert!(filesystem_command(Ok(event)).is_none(), "{access:?}");
        }
    }

    #[test]
    fn writes_renames_and_uncertain_events_preserve_paths() {
        for kind in [
            EventKind::Create(CreateKind::File),
            EventKind::Modify(ModifyKind::Any),
            EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            EventKind::Remove(RemoveKind::File),
            EventKind::Access(AccessKind::Open(AccessMode::Write)),
            EventKind::Access(AccessKind::Close(AccessMode::Write)),
            EventKind::Access(AccessKind::Any),
            EventKind::Access(AccessKind::Other),
            EventKind::Access(AccessKind::Open(AccessMode::Other)),
            EventKind::Access(AccessKind::Close(AccessMode::Any)),
            EventKind::Access(AccessKind::Close(AccessMode::Other)),
            EventKind::Any,
            EventKind::Other,
        ] {
            let paths = vec![PathBuf::from("before"), PathBuf::from("after")];
            let event = Event::new(kind)
                .add_path(paths[0].clone())
                .add_path(paths[1].clone());
            assert!(
                matches!(filesystem_command(Ok(event)), Some(Command::Filesystem(actual)) if actual == paths),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn errors_and_rescan_flags_remain_overflow_even_on_read_events() {
        assert!(
            matches!(filesystem_command(Err(notify::Error::generic("synthetic error"))), Some(Command::Overflow(message)) if message.contains("synthetic error"))
        );
        for kind in [EventKind::Access(AccessKind::Read), EventKind::Any] {
            assert!(matches!(
                filesystem_command(Ok(Event::new(kind).set_flag(Flag::Rescan))),
                Some(Command::Overflow(_))
            ));
        }
    }
}
