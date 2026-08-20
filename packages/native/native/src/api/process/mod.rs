use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use crate::platform::process as sys_process;
use crate::process::{
    self, Containment, EnforcementEntry, InspectionResult, ManagedProcess, ManagedProcessEvents,
    ManagedTarget, OutputDrain, OutputStats, RequestedOutputPolicy, RequestedPolicy,
    ResourcePolicy, SpawnOptions, TerminationResult,
};

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeOutputPolicy {
    pub queue_bytes: Option<f64>,
    pub batch_bytes: Option<f64>,
    pub total_bytes: Option<f64>,
    pub overflow: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeResourcePolicy {
    pub enforcement: Option<String>,
    pub memory_bytes: Option<f64>,
    pub max_cpu_cores: Option<f64>,
    pub max_processes: Option<f64>,
    pub wall_time_ms: Option<f64>,
    pub output: Option<NativeOutputPolicy>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeSpawnOptions {
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub policy: Option<NativeResourcePolicy>,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeRuntimeOptions {
    pub max_active_processes: f64,
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeManagedTarget {
    pub pid: u32,
    pub process_group_id: Option<u32>,
    pub containment: String,
    pub identity: String,
}

impl From<NativeManagedTarget> for ManagedTarget {
    fn from(value: NativeManagedTarget) -> Self {
        Self {
            pid: value.pid,
            process_group_id: value.process_group_id,
            containment: Containment::from_boundary(value.containment),
            identity: value.identity,
        }
    }
}

impl From<ManagedTarget> for NativeManagedTarget {
    fn from(value: ManagedTarget) -> Self {
        Self {
            pid: value.pid,
            process_group_id: value.process_group_id,
            containment: value.containment.as_str().to_string(),
            identity: value.identity,
        }
    }
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeInspectionResult {
    pub evidence: String,
    pub detail: Option<String>,
}

impl From<InspectionResult> for NativeInspectionResult {
    fn from(value: InspectionResult) -> Self {
        Self {
            evidence: value.evidence.as_str().to_string(),
            detail: value.detail,
        }
    }
}

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeTerminationResult {
    pub attempted: bool,
    pub terminated: bool,
    pub method: String,
    pub error: Option<String>,
}

impl From<TerminationResult> for NativeTerminationResult {
    fn from(value: TerminationResult) -> Self {
        Self {
            attempted: value.attempted,
            terminated: value.terminated,
            method: value.method.as_str().to_string(),
            error: value.error,
        }
    }
}

#[napi(object)]
pub struct NativeEnforcementEntry {
    pub resource: String,
    pub status: String,
    pub method: String,
    pub detail: Option<String>,
}

impl From<EnforcementEntry> for NativeEnforcementEntry {
    fn from(value: EnforcementEntry) -> Self {
        Self {
            resource: value.resource,
            status: value.status,
            method: value.method,
            detail: value.detail,
        }
    }
}

#[napi(object)]
pub struct NativeOutputEvent {
    pub stream: String,
    pub data: Buffer,
}

#[napi(object)]
pub struct NativeOutputStats {
    pub stdout_observed_bytes: f64,
    pub stderr_observed_bytes: f64,
    pub stdout_delivered_bytes: f64,
    pub stderr_delivered_bytes: f64,
    pub stdout_omitted_bytes: f64,
    pub stderr_omitted_bytes: f64,
    pub total_observed_bytes: f64,
    pub total_delivered_bytes: f64,
    pub total_omitted_bytes: f64,
}

impl From<OutputStats> for NativeOutputStats {
    fn from(value: OutputStats) -> Self {
        Self {
            stdout_observed_bytes: value.observed[0] as f64,
            stderr_observed_bytes: value.observed[1] as f64,
            stdout_delivered_bytes: value.delivered[0] as f64,
            stderr_delivered_bytes: value.delivered[1] as f64,
            stdout_omitted_bytes: value.omitted[0] as f64,
            stderr_omitted_bytes: value.omitted[1] as f64,
            total_observed_bytes: value.total_observed() as f64,
            total_delivered_bytes: value.total_delivered() as f64,
            total_omitted_bytes: value.total_omitted() as f64,
        }
    }
}

#[napi(object)]
pub struct NativeOutputDrain {
    pub events: Vec<NativeOutputEvent>,
    pub has_more: bool,
    pub pipes_closed: bool,
    pub stats: NativeOutputStats,
}

impl From<OutputDrain> for NativeOutputDrain {
    fn from(value: OutputDrain) -> Self {
        Self {
            events: value
                .events
                .into_iter()
                .map(|event| NativeOutputEvent {
                    stream: event.stream.as_str().to_string(),
                    data: Buffer::from(event.data),
                })
                .collect(),
            has_more: value.has_more,
            pipes_closed: value.pipes_closed,
            stats: value.stats.into(),
        }
    }
}

#[napi]
pub struct NativeManagedProcess {
    process: ManagedProcess,
}

#[napi]
impl NativeManagedProcess {
    #[napi(getter)]
    pub fn pid(&self) -> u32 {
        self.process.target().pid
    }

    #[napi(getter)]
    pub fn identity(&self) -> String {
        self.process.target().identity
    }

    #[napi(getter)]
    pub fn containment(&self) -> String {
        self.process.target().containment.as_str().to_string()
    }

    #[napi(getter)]
    pub fn process_group_id(&self) -> Option<u32> {
        self.process.target().process_group_id
    }

    #[napi(getter)]
    pub fn target(&self) -> NativeManagedTarget {
        self.process.target().into()
    }

    #[napi(getter)]
    pub fn batch_bytes(&self) -> f64 {
        self.process.batch_bytes() as f64
    }

    #[napi(getter)]
    pub fn enforcement(&self) -> Vec<NativeEnforcementEntry> {
        self.process
            .enforcement()
            .iter()
            .cloned()
            .map(Into::into)
            .collect()
    }

    #[napi]
    pub fn drain_output(&self, maximum_bytes: Option<f64>) -> Result<NativeOutputDrain> {
        let maximum = maximum_bytes
            .map(|value| positive_usize("maximumBytes", value))
            .transpose()?
            .unwrap_or_else(|| self.process.batch_bytes());
        Ok(self.process.drain_output(Some(maximum)).into())
    }

    #[napi]
    pub fn terminate(&self, signal: Option<String>) -> NativeTerminationResult {
        self.process
            .terminate(signal.as_deref().unwrap_or("SIGKILL"))
            .into()
    }
}

#[napi]
pub fn configure_managed_process_runtime(options: NativeRuntimeOptions) -> Result<()> {
    let maximum = positive_usize("maxActiveProcesses", options.max_active_processes)?;
    process::configure_registry(maximum).map_err(napi::Error::from_reason)
}

#[napi]
pub fn inspect_managed_target(target: NativeManagedTarget) -> NativeInspectionResult {
    sys_process::inspect(&target.into()).into()
}

#[napi]
pub fn terminate_managed_target(
    target: NativeManagedTarget,
    signal: Option<String>,
) -> NativeTerminationResult {
    sys_process::terminate(&target.into(), signal.as_deref().unwrap_or("SIGKILL")).into()
}

#[napi]
pub fn spawn_managed_process(
    command: String,
    args: Vec<String>,
    options: NativeSpawnOptions,
    output_ready_callback: ThreadsafeFunction<()>,
    exit_callback: ThreadsafeFunction<(i32, String, String)>,
) -> Result<NativeManagedProcess> {
    let output_callback = Arc::new(Mutex::new(Some(output_ready_callback)));
    let ready_callback = Arc::clone(&output_callback);
    let close_callback = Arc::clone(&output_callback);
    let events = ManagedProcessEvents::new(
        move || {
            if let Some(callback) = ready_callback
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .as_ref()
            {
                let _ = callback.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
            }
        },
        move || {
            close_callback
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .take();
        },
        move |result| {
            let _ = exit_callback.call(Ok(result), ThreadsafeFunctionCallMode::NonBlocking);
        },
    );
    let requested = options.policy.map(Into::into).unwrap_or_default();
    let policy = ResourcePolicy::normalize(requested).map_err(napi::Error::from_reason)?;
    let process = process::spawn(
        command,
        args,
        SpawnOptions {
            cwd: options.cwd,
            env: options.env,
            policy,
        },
        events,
    )
    .map_err(napi::Error::from_reason)?;
    Ok(NativeManagedProcess { process })
}

impl From<NativeResourcePolicy> for RequestedPolicy {
    fn from(value: NativeResourcePolicy) -> Self {
        Self {
            enforcement: value.enforcement,
            memory_bytes: value.memory_bytes,
            max_cpu_cores: value.max_cpu_cores,
            max_processes: value.max_processes,
            wall_time_ms: value.wall_time_ms,
            output: value.output.map(Into::into),
        }
    }
}

impl From<NativeOutputPolicy> for RequestedOutputPolicy {
    fn from(value: NativeOutputPolicy) -> Self {
        Self {
            queue_bytes: value.queue_bytes,
            batch_bytes: value.batch_bytes,
            total_bytes: value.total_bytes,
            overflow: value.overflow,
        }
    }
}

fn positive_usize(name: &str, value: f64) -> Result<usize> {
    if !value.is_finite() || value <= 0.0 || value.fract() != 0.0 || value > usize::MAX as f64 {
        return Err(napi::Error::from_reason(format!(
            "{name} must be a positive integer"
        )));
    }
    Ok(value as usize)
}
