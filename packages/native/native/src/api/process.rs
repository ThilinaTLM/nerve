use std::collections::HashMap;

use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use nerve_process_core::{
    self as process, Containment, InspectionResult, ManagedProcess, ManagedProcessEvents,
    ManagedTarget, ProcessPriority, SpawnOptions, TerminationResult,
};

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeSpawnOptions {
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
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

    #[napi]
    pub fn terminate(&self, signal: Option<String>) -> NativeTerminationResult {
        self.process
            .terminate(signal.as_deref().unwrap_or("SIGKILL"))
            .into()
    }
}

#[napi]
pub fn inspect_managed_target(target: NativeManagedTarget) -> NativeInspectionResult {
    process::inspect(&target.into()).into()
}

#[napi]
pub fn terminate_managed_target(
    target: NativeManagedTarget,
    signal: Option<String>,
) -> NativeTerminationResult {
    process::terminate(&target.into(), signal.as_deref().unwrap_or("SIGKILL")).into()
}

#[napi]
pub fn spawn_managed_process(
    command: String,
    args: Vec<String>,
    options: NativeSpawnOptions,
    stdout_callback: ThreadsafeFunction<Buffer>,
    stderr_callback: ThreadsafeFunction<Buffer>,
    exit_callback: ThreadsafeFunction<(i32, String)>,
    close_callback: ThreadsafeFunction<(i32, String)>,
) -> Result<NativeManagedProcess> {
    let events = ManagedProcessEvents::new(
        move |chunk| {
            stdout_callback.call(
                Ok(Buffer::from(chunk)),
                ThreadsafeFunctionCallMode::Blocking,
            );
        },
        move |chunk| {
            stderr_callback.call(
                Ok(Buffer::from(chunk)),
                ThreadsafeFunctionCallMode::Blocking,
            );
        },
        move |result| {
            exit_callback.call(Ok(result), ThreadsafeFunctionCallMode::NonBlocking);
        },
        move |result| {
            close_callback.call(Ok(result), ThreadsafeFunctionCallMode::NonBlocking);
        },
    );
    let process = process::spawn(
        command,
        args,
        SpawnOptions {
            cwd: options.cwd,
            env: options.env,
            priority: ProcessPriority::Normal,
        },
        events,
    )
    .map_err(napi::Error::from_reason)?;
    Ok(NativeManagedProcess { process })
}
