use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::process::{ManagedTarget, ProcessPriority, TerminationMethod, TerminationResult};
use crate::sys::process::{self as sys_process, ContainmentGuard};

#[derive(Clone, Debug)]
pub struct SpawnOptions {
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub priority: ProcessPriority,
}

pub struct ManagedProcessEvents {
    stdout: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
    stderr: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
    exit: Arc<dyn Fn((i32, String)) + Send + Sync>,
    close: Arc<dyn Fn((i32, String)) + Send + Sync>,
}

impl ManagedProcessEvents {
    pub fn new(
        stdout: impl Fn(Vec<u8>) + Send + Sync + 'static,
        stderr: impl Fn(Vec<u8>) + Send + Sync + 'static,
        exit: impl Fn((i32, String)) + Send + Sync + 'static,
        close: impl Fn((i32, String)) + Send + Sync + 'static,
    ) -> Self {
        Self {
            stdout: Arc::new(stdout),
            stderr: Arc::new(stderr),
            exit: Arc::new(exit),
            close: Arc::new(close),
        }
    }
}

struct ManagedState {
    target: ManagedTarget,
    exited: AtomicBool,
    containment_guard: Mutex<Option<ContainmentGuard>>,
}

pub struct ManagedProcess {
    state: Arc<ManagedState>,
}

impl ManagedProcess {
    pub fn target(&self) -> ManagedTarget {
        self.state.target.clone()
    }

    pub fn terminate(&self, signal: &str) -> TerminationResult {
        if self.state.exited.load(Ordering::Acquire) {
            return TerminationResult::not_attempted(TerminationMethod::None, None);
        }
        let guard = self
            .state
            .containment_guard
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(result) = guard.as_ref().and_then(ContainmentGuard::terminate) {
            return result;
        }
        sys_process::terminate(&self.state.target, signal)
    }
}

pub fn spawn(
    command: String,
    args: Vec<String>,
    options: SpawnOptions,
    events: ManagedProcessEvents,
) -> Result<ManagedProcess, String> {
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

    let spawned = sys_process::spawn_contained(&mut process, options.priority)?;
    let mut child = spawned.child;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let state = Arc::new(ManagedState {
        target: spawned.target,
        exited: AtomicBool::new(false),
        containment_guard: Mutex::new(Some(spawned.containment_guard)),
    });

    let mut output_threads = Vec::new();
    if let Some(stdout) = stdout {
        output_threads.push(relay_output(stdout, events.stdout));
    }
    if let Some(stderr) = stderr {
        output_threads.push(relay_output(stderr, events.stderr));
    }

    let wait_state = Arc::clone(&state);
    thread::spawn(move || {
        let result = match child.wait() {
            Ok(status) => sys_process::exit_parts(status),
            Err(error) => (-1, error.to_string()),
        };
        wait_state.exited.store(true, Ordering::Release);
        (events.exit)(result.clone());
        // Closing the kill-on-close Windows Job after the root exits prevents
        // descendants from keeping inherited pipes open forever. The Unix guard
        // is deliberately inert because process groups do not own a handle.
        let _ = wait_state
            .containment_guard
            .lock()
            .map(|mut guard| guard.take());
        for output_thread in output_threads {
            let _ = output_thread.join();
        }
        (events.close)(result);
    });

    Ok(ManagedProcess { state })
}

fn relay_output<R: Read + Send + 'static>(
    mut reader: R,
    callback: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => callback(buffer[..length].to_vec()),
                Err(_) => break,
            }
        }
    })
}
