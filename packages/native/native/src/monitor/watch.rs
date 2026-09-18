use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::SyncSender;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};

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
            let command = match result {
                Ok(event) => Command::Filesystem(event.paths),
                Err(error) => Command::Overflow(error.to_string()),
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
