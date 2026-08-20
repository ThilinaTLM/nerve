use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use crate::platform::process::{self as sys_process, ContainmentGuard};
use crate::process::{
    ActivePermit, EnforcementEntry, ExitReason, IngestResult, ManagedTarget, OutputDrain,
    OutputQueue, OutputStream, ResourcePolicy, TerminationMethod, TerminationResult,
};
use crate::runtime;

#[derive(Clone, Debug)]
pub(crate) struct SpawnOptions {
    pub(crate) cwd: Option<String>,
    pub(crate) env: Option<HashMap<String, String>>,
    pub(crate) policy: ResourcePolicy,
}

pub(crate) struct ManagedProcessEvents {
    output_ready: Arc<dyn Fn() + Send + Sync>,
    output_closed: Arc<dyn Fn() + Send + Sync>,
    exit: Arc<dyn Fn((i32, String, String)) + Send + Sync>,
}

impl ManagedProcessEvents {
    pub(crate) fn new(
        output_ready: impl Fn() + Send + Sync + 'static,
        output_closed: impl Fn() + Send + Sync + 'static,
        exit: impl Fn((i32, String, String)) + Send + Sync + 'static,
    ) -> Self {
        Self {
            output_ready: Arc::new(output_ready),
            output_closed: Arc::new(output_closed),
            exit: Arc::new(exit),
        }
    }
}

struct ManagedState {
    target: ManagedTarget,
    exited: AtomicBool,
    containment_guard: Mutex<Option<ContainmentGuard>>,
    active_permit: Mutex<Option<ActivePermit>>,
    output: Arc<OutputQueue>,
    exit_reason: Mutex<Option<ExitReason>>,
    output_closed: Arc<dyn Fn() + Send + Sync>,
    output_released: AtomicBool,
}

impl ManagedState {
    fn mark_reason(&self, reason: ExitReason) {
        let mut current = self
            .exit_reason
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if current.is_none() {
            *current = Some(reason);
        }
    }

    fn terminate(&self, signal: &str, reason: Option<ExitReason>) -> TerminationResult {
        if let Some(reason) = reason {
            self.mark_reason(reason);
        }
        let guard = self
            .containment_guard
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(result) = guard
            .as_ref()
            .and_then(|guard| guard.terminate(&self.target, signal))
        {
            return result;
        }
        if self.exited.load(Ordering::Acquire) {
            return TerminationResult::not_attempted(TerminationMethod::None, None);
        }
        sys_process::terminate(&self.target, signal)
    }

    fn platform_exit_reason(&self) -> Option<ExitReason> {
        self.containment_guard
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .as_ref()
            .and_then(ContainmentGuard::exit_reason)
    }

    fn release_if_complete(&self) {
        if !self.output.is_complete() {
            return;
        }
        let guard = self
            .containment_guard
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if let Some(guard) = guard {
            guard.release();
        }
        self.active_permit
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        if !self.output_released.swap(true, Ordering::AcqRel) {
            (self.output_closed)();
        }
    }
}

pub(crate) struct ManagedProcess {
    state: Arc<ManagedState>,
    enforcement: Vec<EnforcementEntry>,
    batch_bytes: usize,
}

impl ManagedProcess {
    pub(crate) fn target(&self) -> ManagedTarget {
        self.state.target.clone()
    }

    pub(crate) fn terminate(&self, signal: &str) -> TerminationResult {
        self.state.terminate(signal, None)
    }

    pub(crate) fn drain_output(&self, maximum: Option<usize>) -> OutputDrain {
        let drained = self
            .state
            .output
            .drain(maximum.unwrap_or(self.batch_bytes).max(1));
        if drained.pipes_closed && !drained.has_more {
            self.state.release_if_complete();
        }
        drained
    }

    pub(crate) fn enforcement(&self) -> &[EnforcementEntry] {
        &self.enforcement
    }

    pub(crate) fn batch_bytes(&self) -> usize {
        self.batch_bytes
    }
}

pub(crate) fn spawn(
    command: String,
    args: Vec<String>,
    options: SpawnOptions,
    events: ManagedProcessEvents,
) -> Result<ManagedProcess, String> {
    let permit = ActivePermit::acquire()?;
    let runtime_handle = runtime::handle()?;
    let output_callback = Arc::clone(&events.output_ready);
    let output = Arc::new(OutputQueue::new(options.policy.output.clone(), move || {
        output_callback();
    }));

    let mut process = Command::new(command);
    process
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = options.cwd {
        process.current_dir(cwd);
    }
    if let Some(env) = options.env {
        process.env_clear().envs(env);
    }

    let (spawned, enforcement) = {
        let _entered = runtime_handle.enter();
        sys_process::spawn_contained(&mut process, &options.policy)?
    };
    let mut child = spawned.child;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let state = Arc::new(ManagedState {
        target: spawned.target,
        exited: AtomicBool::new(false),
        containment_guard: Mutex::new(Some(spawned.containment_guard)),
        active_permit: Mutex::new(Some(permit)),
        output,
        exit_reason: Mutex::new(None),
        output_closed: Arc::clone(&events.output_closed),
        output_released: AtomicBool::new(false),
    });

    match stdout {
        Some(stdout) => spawn_output_reader(
            &runtime_handle,
            stdout,
            OutputStream::Stdout,
            Arc::clone(&state),
        ),
        None => state.output.finish_stream(),
    }
    match stderr {
        Some(stderr) => spawn_output_reader(
            &runtime_handle,
            stderr,
            OutputStream::Stderr,
            Arc::clone(&state),
        ),
        None => state.output.finish_stream(),
    }

    if let Some(wall_time_ms) = options.policy.wall_time_ms {
        let weak_state = Arc::downgrade(&state);
        runtime_handle.spawn(async move {
            tokio::time::sleep(Duration::from_millis(wall_time_ms)).await;
            if let Some(state) = weak_state.upgrade()
                && !state.exited.load(Ordering::Acquire)
            {
                let _ = state.terminate("SIGKILL", Some(ExitReason::Timeout));
            }
        });
    }

    let wait_state = Arc::clone(&state);
    runtime_handle.spawn(async move {
        let result = match child.wait().await {
            Ok(status) => sys_process::exit_parts(status),
            Err(error) => {
                wait_state.mark_reason(ExitReason::Internal);
                (-1, error.to_string())
            }
        };
        wait_state.exited.store(true, Ordering::Release);
        let reason = wait_state
            .exit_reason
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .or_else(|| wait_state.platform_exit_reason())
            .unwrap_or(if result.1.is_empty() {
                ExitReason::Exited
            } else {
                ExitReason::Signal
            });
        (events.exit)((result.0, result.1, reason.as_str().to_string()));
    });

    Ok(ManagedProcess {
        batch_bytes: options.policy.output.batch_bytes,
        state,
        enforcement,
    })
}

fn spawn_output_reader<R>(
    runtime_handle: &tokio::runtime::Handle,
    mut reader: R,
    stream: OutputStream,
    state: Arc<ManagedState>,
) where
    R: AsyncRead + Unpin + Send + 'static,
{
    runtime_handle.spawn(async move {
        let mut buffer = vec![0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer).await {
                Ok(0) => break,
                Ok(length) => {
                    if matches!(
                        state.output.ingest(stream, buffer[..length].to_vec()).await,
                        IngestResult::Terminate
                    ) {
                        let _ = state.terminate("SIGKILL", Some(ExitReason::OutputLimit));
                    }
                }
                Err(_) => break,
            }
        }
        state.output.finish_stream();
    });
}
