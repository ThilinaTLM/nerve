use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::git;
use super::model::{
    ChangeNotice, MonitorDiagnostics, MonitorLimits, PendingChange, ScopeKind, ScopeSpec,
    ScopeState,
};
use super::pipeline::{is_due, merge_trigger, notice};
use super::watch::{WatchBackend, canonical_directory};

const COMMAND_CAPACITY: usize = 1_024;
const LOOP_INTERVAL: Duration = Duration::from_millis(50);

type NoticeCallback = Arc<dyn Fn(ChangeNotice) + Send + Sync + 'static>;

pub(crate) enum Command {
    Sync(ScopeSpec, mpsc::Sender<Result<ScopeState, String>>),
    Refresh(String, mpsc::Sender<Result<u64, String>>),
    Remove(String, mpsc::Sender<Result<(), String>>),
    Diagnostics(mpsc::Sender<MonitorDiagnostics>),
    Filesystem(Vec<PathBuf>),
    Overflow(String),
    Fingerprint(String, Result<u64, String>),
    Close(mpsc::Sender<()>),
}

pub struct Monitor {
    commands: SyncSender<Command>,
    thread: Mutex<Option<JoinHandle<()>>>,
}

impl Monitor {
    pub fn new(limits: MonitorLimits, callback: NoticeCallback) -> Result<Self, String> {
        let (commands, receiver) = mpsc::sync_channel(COMMAND_CAPACITY);
        let watch_commands = commands.clone();
        let worker_commands = commands.clone();
        let queue_overflowed = Arc::new(AtomicBool::new(false));
        let worker_overflowed = Arc::clone(&queue_overflowed);
        let (started_tx, started_rx) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("nerve-change-monitor".into())
            .spawn(move || {
                let backend = WatchBackend::new(watch_commands, queue_overflowed);
                match backend {
                    Ok(backend) => {
                        let _ = started_tx.send(Ok(()));
                        Worker::new(
                            receiver,
                            worker_commands,
                            backend,
                            limits,
                            callback,
                            worker_overflowed,
                        )
                        .run();
                    }
                    Err(error) => {
                        let _ = started_tx.send(Err(error));
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        started_rx.recv().map_err(|error| error.to_string())??;
        Ok(Self {
            commands,
            thread: Mutex::new(Some(thread)),
        })
    }

    pub fn sync(&self, spec: ScopeSpec) -> Result<ScopeState, String> {
        let (reply, result) = mpsc::channel();
        self.commands
            .send(Command::Sync(spec, reply))
            .map_err(|_| "Change monitor is closed".to_string())?;
        result.recv().map_err(|error| error.to_string())?
    }

    pub fn refresh(&self, scope_id: String) -> Result<u64, String> {
        let (reply, result) = mpsc::channel();
        self.commands
            .send(Command::Refresh(scope_id, reply))
            .map_err(|_| "Change monitor is closed".to_string())?;
        result.recv().map_err(|error| error.to_string())?
    }

    pub fn remove(&self, scope_id: String) -> Result<(), String> {
        let (reply, result) = mpsc::channel();
        self.commands
            .send(Command::Remove(scope_id, reply))
            .map_err(|_| "Change monitor is closed".to_string())?;
        result.recv().map_err(|error| error.to_string())?
    }

    pub fn diagnostics(&self) -> MonitorDiagnostics {
        let (reply, result) = mpsc::channel();
        if self.commands.send(Command::Diagnostics(reply)).is_err() {
            return MonitorDiagnostics::default();
        }
        result.recv().unwrap_or_default()
    }

    pub fn close(&self) {
        let mut thread = self
            .thread
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let Some(handle) = thread.take() else { return };
        let (reply, closed) = mpsc::channel();
        let _ = self.commands.send(Command::Close(reply));
        let _ = closed.recv();
        let _ = handle.join();
    }
}

impl Drop for Monitor {
    fn drop(&mut self) {
        self.close();
    }
}

struct Scope {
    kind: ScopeKind,
    paths: HashSet<PathBuf>,
    poll_interval: Duration,
    next_poll: Instant,
    generation: u64,
    pending: Option<PendingChange>,
    degraded: bool,
    fingerprint: Option<u64>,
    fingerprint_inflight: bool,
}

struct Worker {
    receiver: Receiver<Command>,
    commands: SyncSender<Command>,
    backend: WatchBackend,
    limits: MonitorLimits,
    callback: NoticeCallback,
    scopes: HashMap<String, Scope>,
    registrations: HashMap<PathBuf, HashSet<String>>,
    diagnostics: MonitorDiagnostics,
    queue_overflowed: Arc<AtomicBool>,
}

impl Worker {
    fn new(
        receiver: Receiver<Command>,
        commands: SyncSender<Command>,
        backend: WatchBackend,
        limits: MonitorLimits,
        callback: NoticeCallback,
        queue_overflowed: Arc<AtomicBool>,
    ) -> Self {
        Self {
            receiver,
            commands,
            backend,
            limits,
            callback,
            scopes: HashMap::new(),
            registrations: HashMap::new(),
            diagnostics: MonitorDiagnostics::default(),
            queue_overflowed,
        }
    }

    fn run(mut self) {
        loop {
            match self.receiver.recv_timeout(LOOP_INTERVAL) {
                Ok(Command::Sync(spec, reply)) => {
                    let result = self.sync_scope(spec);
                    let _ = reply.send(result);
                }
                Ok(Command::Refresh(id, reply)) => {
                    let result = self.manual_refresh(&id);
                    let _ = reply.send(result);
                }
                Ok(Command::Remove(id, reply)) => {
                    self.remove_scope(&id);
                    let _ = reply.send(Ok(()));
                }
                Ok(Command::Diagnostics(reply)) => {
                    self.update_diagnostic_gauges();
                    let _ = reply.send(self.diagnostics.clone());
                }
                Ok(Command::Filesystem(paths)) => self.filesystem(paths),
                Ok(Command::Overflow(_error)) => self.overflow(),
                Ok(Command::Fingerprint(id, result)) => self.fingerprint(&id, result),
                Ok(Command::Close(reply)) => {
                    let ids: Vec<_> = self.scopes.keys().cloned().collect();
                    for id in ids {
                        self.remove_scope(&id);
                    }
                    let _ = reply.send(());
                    return;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
            }
            if self.queue_overflowed.swap(false, Ordering::AcqRel) {
                self.overflow();
            }
            self.poll();
            self.flush_due();
        }
    }

    fn sync_scope(&mut self, spec: ScopeSpec) -> Result<ScopeState, String> {
        if !self.scopes.contains_key(&spec.id) && self.scopes.len() >= self.limits.max_scopes {
            return Err("Change monitor scope limit reached".into());
        }
        let maximum = match &spec.kind {
            ScopeKind::Directories => self.limits.max_directories_per_scope,
            ScopeKind::Git { .. } => self.limits.max_git_paths,
        };
        let paths = match &spec.kind {
            ScopeKind::Directories => spec.paths.clone(),
            ScopeKind::Git { repository } => git::watch_paths(repository, maximum)?,
        };
        let mut canonical = Vec::new();
        for path in paths {
            let path = canonical_directory(path)?;
            if !canonical.contains(&path) {
                canonical.push(path);
            }
        }
        canonical.sort_by(|left, right| {
            left.components()
                .count()
                .cmp(&right.components().count())
                .then_with(|| left.cmp(right))
        });
        let requested_count = canonical.len();
        canonical.truncate(maximum);
        let existing = self
            .scopes
            .get(&spec.id)
            .map(|scope| scope.paths.clone())
            .unwrap_or_default();
        let desired: HashSet<_> = canonical.into_iter().collect();
        let new_unique = desired
            .iter()
            .filter(|path| !self.registrations.contains_key(*path))
            .count();
        let removed_unique = existing
            .iter()
            .filter(|path| {
                !desired.contains(*path)
                    && self
                        .registrations
                        .get(*path)
                        .is_some_and(|owners| owners.len() == 1)
            })
            .count();
        let available = self
            .limits
            .max_registrations
            .saturating_sub(self.registrations.len().saturating_sub(removed_unique));
        let mut selected = desired;
        let mut degraded = requested_count > maximum;
        if new_unique > available {
            let mut unique: Vec<_> = selected
                .iter()
                .filter(|path| !self.registrations.contains_key(*path))
                .cloned()
                .collect();
            unique.sort();
            for path in unique.into_iter().skip(available) {
                selected.remove(&path);
                degraded = true;
            }
        }
        let additions: Vec<_> = selected.difference(&existing).cloned().collect();
        let mut newly_watched: Vec<PathBuf> = Vec::new();
        for path in &additions {
            if !self.registrations.contains_key(path) {
                if let Err(error) = self.backend.watch(path) {
                    for watched in newly_watched {
                        let _ = self.backend.unwatch(&watched);
                    }
                    return Err(error);
                }
                newly_watched.push(path.clone());
            }
        }
        for path in existing.difference(&selected) {
            self.release_registration(path, &spec.id);
        }
        for path in &additions {
            self.registrations
                .entry(path.clone())
                .or_default()
                .insert(spec.id.clone());
        }
        let generation = self
            .scopes
            .get(&spec.id)
            .map_or(0, |scope| scope.generation);
        let fingerprint = match &spec.kind {
            ScopeKind::Git { repository } => git::fingerprint(repository).ok(),
            ScopeKind::Directories => None,
        };
        let watched_paths = selected.len();
        self.scopes.insert(
            spec.id,
            Scope {
                kind: spec.kind,
                paths: selected,
                poll_interval: spec.poll_interval,
                next_poll: Instant::now() + spec.poll_interval,
                generation,
                pending: None,
                degraded,
                fingerprint,
                fingerprint_inflight: false,
            },
        );
        Ok(ScopeState {
            generation,
            watched_paths,
            degraded,
        })
    }

    fn manual_refresh(&mut self, id: &str) -> Result<u64, String> {
        let now = Instant::now();
        let scope = self
            .scopes
            .get_mut(id)
            .ok_or_else(|| format!("Unknown monitor scope {id}"))?;
        merge_trigger(&mut scope.pending, "manual", None, true, now);
        Ok(self
            .flush(id)
            .expect("manual trigger creates pending notice"))
    }

    fn filesystem(&mut self, paths: Vec<PathBuf>) {
        if paths.is_empty() {
            self.overflow();
            return;
        }
        let now = Instant::now();
        for changed in paths {
            let ids: HashSet<_> = self
                .registrations
                .iter()
                .filter(|(root, _)| changed.starts_with(root))
                .flat_map(|(_, ids)| ids.iter().cloned())
                .collect();
            for id in ids {
                if let Some(scope) = self.scopes.get_mut(&id)
                    && merge_trigger(
                        &mut scope.pending,
                        "filesystem",
                        Some(changed.clone()),
                        false,
                        now,
                    )
                {
                    self.diagnostics.coalesced_triggers += 1;
                }
            }
        }
    }

    fn overflow(&mut self) {
        self.diagnostics.overflows += 1;
        let now = Instant::now();
        for scope in self.scopes.values_mut() {
            merge_trigger(&mut scope.pending, "overflow", None, true, now);
        }
    }

    fn poll(&mut self) {
        let now = Instant::now();
        let due: Vec<_> = self
            .scopes
            .iter()
            .filter(|(_, scope)| now >= scope.next_poll)
            .map(|(id, _)| id.clone())
            .collect();
        for id in due {
            let Some(scope) = self.scopes.get_mut(&id) else {
                continue;
            };
            scope.next_poll = now + scope.poll_interval;
            self.diagnostics.poll_count += 1;
            match &scope.kind {
                ScopeKind::Directories => {
                    merge_trigger(&mut scope.pending, "poll", None, true, now);
                }
                ScopeKind::Git { repository } if !scope.fingerprint_inflight => {
                    scope.fingerprint_inflight = true;
                    let repository = repository.clone();
                    let commands = self.commands.clone();
                    let queue_overflowed = Arc::clone(&self.queue_overflowed);
                    match crate::runtime::handle() {
                        Ok(handle) => {
                            handle.spawn_blocking(move || {
                                let result = git::fingerprint(&repository);
                                if commands.try_send(Command::Fingerprint(id, result)).is_err() {
                                    queue_overflowed.store(true, Ordering::Release);
                                }
                            });
                        }
                        Err(_error) => {
                            scope.fingerprint_inflight = false;
                            self.diagnostics.poll_failures += 1;
                            merge_trigger(&mut scope.pending, "poll_error", None, true, now);
                        }
                    }
                }
                ScopeKind::Git { .. } => {}
            }
        }
    }

    fn fingerprint(&mut self, id: &str, result: Result<u64, String>) {
        let Some(scope) = self.scopes.get_mut(id) else {
            return;
        };
        scope.fingerprint_inflight = false;
        let now = Instant::now();
        match result {
            Ok(fingerprint) if scope.fingerprint != Some(fingerprint) => {
                scope.fingerprint = Some(fingerprint);
                merge_trigger(&mut scope.pending, "poll", None, true, now);
            }
            Ok(_) => {}
            Err(_) => {
                self.diagnostics.poll_failures += 1;
                merge_trigger(&mut scope.pending, "poll_error", None, true, now);
            }
        }
    }

    fn flush_due(&mut self) {
        let now = Instant::now();
        let due: Vec<_> = self
            .scopes
            .iter()
            .filter(|(_, scope)| {
                scope
                    .pending
                    .as_ref()
                    .is_some_and(|change| is_due(change, now))
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in due {
            self.flush(&id);
        }
    }

    fn flush(&mut self, id: &str) -> Option<u64> {
        let scope = self.scopes.get_mut(id)?;
        let pending = scope.pending.take()?;
        scope.generation += 1;
        let generation = scope.generation;
        let notice = notice(
            id.to_string(),
            generation,
            pending,
            self.limits.max_paths_per_notice,
        );
        self.diagnostics.emitted_notices += 1;
        (self.callback)(notice);
        Some(generation)
    }

    fn remove_scope(&mut self, id: &str) {
        let Some(scope) = self.scopes.remove(id) else {
            return;
        };
        for path in scope.paths {
            self.release_registration(&path, id);
        }
    }

    fn release_registration(&mut self, path: &PathBuf, id: &str) {
        let remove = if let Some(owners) = self.registrations.get_mut(path) {
            owners.remove(id);
            owners.is_empty()
        } else {
            false
        };
        if remove {
            self.registrations.remove(path);
            let _ = self.backend.unwatch(path);
        }
    }

    fn update_diagnostic_gauges(&mut self) {
        self.diagnostics.active_scopes = self.scopes.len();
        self.diagnostics.registrations = self.registrations.len();
        self.diagnostics.degraded_scopes =
            self.scopes.values().filter(|scope| scope.degraded).count();
    }
}
