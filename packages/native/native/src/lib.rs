mod managed_process;
mod platform;

use std::collections::HashMap;

use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::ThreadsafeFunction;
use napi_derive::napi;

pub use managed_process::NativeManagedProcess;

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

#[napi(object)]
#[derive(Clone, Debug)]
pub struct NativeInspectionResult {
    pub evidence: String,
    pub detail: Option<String>,
}

impl NativeInspectionResult {
    pub(crate) fn alive() -> Self {
        Self {
            evidence: "alive_verified".to_string(),
            detail: None,
        }
    }

    pub(crate) fn exited() -> Self {
        Self {
            evidence: "exited_verified".to_string(),
            detail: None,
        }
    }

    pub(crate) fn mismatch() -> Self {
        Self {
            evidence: "identity_mismatch".to_string(),
            detail: Some("PID was reused by another process".to_string()),
        }
    }

    pub(crate) fn unknown(detail: impl Into<String>) -> Self {
        Self {
            evidence: "unknown".to_string(),
            detail: Some(detail.into()),
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

impl NativeTerminationResult {
    pub(crate) fn not_attempted(method: &str, error: Option<String>) -> Self {
        Self {
            attempted: false,
            terminated: false,
            method: method.to_string(),
            error,
        }
    }

    pub(crate) fn terminated(method: &str) -> Self {
        Self {
            attempted: true,
            terminated: true,
            method: method.to_string(),
            error: None,
        }
    }

    pub(crate) fn failed(method: &str, error: impl Into<String>) -> Self {
        Self {
            attempted: true,
            terminated: false,
            method: method.to_string(),
            error: Some(error.into()),
        }
    }
}

#[napi(object)]
pub struct NativeRuntimeCapabilities {
    pub platform: String,
    pub capabilities: Vec<String>,
}

#[napi]
pub fn runtime_capabilities() -> NativeRuntimeCapabilities {
    NativeRuntimeCapabilities {
        platform: std::env::consts::OS.to_string(),
        capabilities: platform::capabilities(),
    }
}

#[napi]
pub fn inspect_managed_target(target: NativeManagedTarget) -> NativeInspectionResult {
    platform::inspect(&target)
}

#[napi]
pub fn terminate_managed_target(
    target: NativeManagedTarget,
    signal: Option<String>,
) -> NativeTerminationResult {
    platform::terminate(&target, signal.as_deref().unwrap_or("SIGKILL"))
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
    managed_process::spawn(
        command,
        args,
        options,
        stdout_callback,
        stderr_callback,
        exit_callback,
        close_callback,
    )
}
