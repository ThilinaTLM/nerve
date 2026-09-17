use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use napi::Env;
use napi::bindgen_prelude::{AsyncTask, Result, Task};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use crate::monitor::{
    ChangeNotice, Monitor, MonitorDiagnostics, MonitorLimits, ScopeKind, ScopeSpec, ScopeState,
};

#[napi(object)]
pub struct NativeMonitorOptions {
    pub max_scopes: Option<f64>,
    pub max_registrations: Option<f64>,
    pub max_directories_per_scope: Option<f64>,
    pub max_git_paths: Option<f64>,
    pub max_paths_per_notice: Option<f64>,
}

#[napi(object)]
pub struct NativeDirectoryMonitorScope {
    pub id: String,
    pub paths: Vec<String>,
    pub poll_interval_ms: Option<f64>,
}

#[napi(object)]
pub struct NativeGitMonitorScope {
    pub id: String,
    pub repository: String,
    pub poll_interval_ms: Option<f64>,
}

#[napi(object)]
pub struct NativeMonitorScopeState {
    pub generation: f64,
    pub watched_paths: f64,
    pub degraded: bool,
}

#[napi(object)]
pub struct NativeMonitorNotice {
    pub scope_id: String,
    pub generation: f64,
    pub causes: Vec<String>,
    pub paths: Vec<String>,
    pub full_refresh_required: bool,
}

#[napi(object)]
pub struct NativeMonitorDiagnostics {
    pub active_scopes: f64,
    pub registrations: f64,
    pub degraded_scopes: f64,
    pub emitted_notices: f64,
    pub coalesced_triggers: f64,
    pub overflows: f64,
    pub poll_count: f64,
    pub poll_failures: f64,
}

#[napi]
pub struct NativeChangeMonitor {
    monitor: Arc<Monitor>,
}

#[napi]
impl NativeChangeMonitor {
    #[napi]
    pub fn sync_directories(
        &self,
        scope: NativeDirectoryMonitorScope,
    ) -> Result<AsyncTask<SyncTask>> {
        Ok(AsyncTask::new(SyncTask {
            monitor: Arc::clone(&self.monitor),
            spec: ScopeSpec {
                id: scope.id,
                kind: ScopeKind::Directories,
                paths: scope.paths.into_iter().map(PathBuf::from).collect(),
                poll_interval: duration(scope.poll_interval_ms, 20_000.0)?,
            },
        }))
    }

    #[napi]
    pub fn sync_git(&self, scope: NativeGitMonitorScope) -> Result<AsyncTask<SyncTask>> {
        Ok(AsyncTask::new(SyncTask {
            monitor: Arc::clone(&self.monitor),
            spec: ScopeSpec {
                id: scope.id,
                kind: ScopeKind::Git {
                    repository: PathBuf::from(scope.repository),
                },
                paths: Vec::new(),
                poll_interval: duration(scope.poll_interval_ms, 10_000.0)?,
            },
        }))
    }

    #[napi]
    pub fn request_refresh(&self, scope_id: String) -> AsyncTask<RefreshTask> {
        AsyncTask::new(RefreshTask {
            monitor: Arc::clone(&self.monitor),
            scope_id,
        })
    }

    #[napi]
    pub fn remove(&self, scope_id: String) -> AsyncTask<RemoveTask> {
        AsyncTask::new(RemoveTask {
            monitor: Arc::clone(&self.monitor),
            scope_id,
            close: false,
        })
    }

    #[napi]
    pub fn diagnostics(&self) -> NativeMonitorDiagnostics {
        self.monitor.diagnostics().into()
    }

    #[napi]
    pub fn close(&self) -> AsyncTask<RemoveTask> {
        AsyncTask::new(RemoveTask {
            monitor: Arc::clone(&self.monitor),
            scope_id: String::new(),
            close: true,
        })
    }
}

pub struct SyncTask {
    monitor: Arc<Monitor>,
    spec: ScopeSpec,
}

impl Task for SyncTask {
    type Output = ScopeState;
    type JsValue = NativeMonitorScopeState;

    fn compute(&mut self) -> Result<Self::Output> {
        self.monitor
            .sync(self.spec.clone())
            .map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output.into())
    }
}

pub struct RefreshTask {
    monitor: Arc<Monitor>,
    scope_id: String,
}

impl Task for RefreshTask {
    type Output = u64;
    type JsValue = f64;

    fn compute(&mut self) -> Result<Self::Output> {
        self.monitor
            .refresh(self.scope_id.clone())
            .map_err(napi::Error::from_reason)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output as f64)
    }
}

pub struct RemoveTask {
    monitor: Arc<Monitor>,
    scope_id: String,
    close: bool,
}

impl Task for RemoveTask {
    type Output = ();
    type JsValue = ();

    fn compute(&mut self) -> Result<Self::Output> {
        if self.close {
            self.monitor.close();
            Ok(())
        } else {
            self.monitor
                .remove(self.scope_id.clone())
                .map_err(napi::Error::from_reason)
        }
    }

    fn resolve(&mut self, _env: Env, _output: Self::Output) -> Result<Self::JsValue> {
        Ok(())
    }
}

#[napi]
pub fn create_change_monitor(
    options: Option<NativeMonitorOptions>,
    callback: ThreadsafeFunction<NativeMonitorNotice>,
) -> Result<NativeChangeMonitor> {
    let limits = options
        .map(TryInto::try_into)
        .transpose()?
        .unwrap_or_default();
    let monitor = Monitor::new(
        limits,
        Arc::new(move |notice| {
            let _ = callback.call(Ok(notice.into()), ThreadsafeFunctionCallMode::NonBlocking);
        }),
    )
    .map_err(napi::Error::from_reason)?;
    Ok(NativeChangeMonitor {
        monitor: Arc::new(monitor),
    })
}

fn duration(value: Option<f64>, default: f64) -> Result<Duration> {
    let milliseconds = positive_usize("pollIntervalMs", value.unwrap_or(default))?;
    Ok(Duration::from_millis(milliseconds as u64))
}

fn positive_usize(name: &str, value: f64) -> Result<usize> {
    if !value.is_finite() || value < 1.0 || value.fract() != 0.0 || value > usize::MAX as f64 {
        return Err(napi::Error::from_reason(format!("Invalid {name}")));
    }
    Ok(value as usize)
}

impl TryFrom<NativeMonitorOptions> for MonitorLimits {
    type Error = napi::Error;

    fn try_from(value: NativeMonitorOptions) -> Result<Self> {
        let defaults = Self::default();
        Ok(Self {
            max_scopes: value
                .max_scopes
                .map(|value| positive_usize("maxScopes", value))
                .transpose()?
                .unwrap_or(defaults.max_scopes),
            max_registrations: value
                .max_registrations
                .map(|value| positive_usize("maxRegistrations", value))
                .transpose()?
                .unwrap_or(defaults.max_registrations),
            max_directories_per_scope: value
                .max_directories_per_scope
                .map(|value| positive_usize("maxDirectoriesPerScope", value))
                .transpose()?
                .unwrap_or(defaults.max_directories_per_scope),
            max_git_paths: value
                .max_git_paths
                .map(|value| positive_usize("maxGitPaths", value))
                .transpose()?
                .unwrap_or(defaults.max_git_paths),
            max_paths_per_notice: value
                .max_paths_per_notice
                .map(|value| positive_usize("maxPathsPerNotice", value))
                .transpose()?
                .unwrap_or(defaults.max_paths_per_notice),
        })
    }
}

impl From<ScopeState> for NativeMonitorScopeState {
    fn from(value: ScopeState) -> Self {
        Self {
            generation: value.generation as f64,
            watched_paths: value.watched_paths as f64,
            degraded: value.degraded,
        }
    }
}

impl From<ChangeNotice> for NativeMonitorNotice {
    fn from(value: ChangeNotice) -> Self {
        Self {
            scope_id: value.scope_id,
            generation: value.generation as f64,
            causes: value.causes,
            paths: value.paths,
            full_refresh_required: value.full_refresh_required,
        }
    }
}

impl From<MonitorDiagnostics> for NativeMonitorDiagnostics {
    fn from(value: MonitorDiagnostics) -> Self {
        Self {
            active_scopes: value.active_scopes as f64,
            registrations: value.registrations as f64,
            degraded_scopes: value.degraded_scopes as f64,
            emitted_notices: value.emitted_notices as f64,
            coalesced_triggers: value.coalesced_triggers as f64,
            overflows: value.overflows as f64,
            poll_count: value.poll_count as f64,
            poll_failures: value.poll_failures as f64,
        }
    }
}
