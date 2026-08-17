use std::collections::HashMap;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Arc;
#[cfg(windows)]
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[cfg(windows)]
mod windows;

#[napi(object)]
pub struct NativeSpawnOptions {
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
}

#[napi(object)]
pub struct NativeProcessMetadata {
    pub pid: u32,
    pub identity: String,
    pub containment: String,
}

struct ManagedState {
    #[cfg(unix)]
    pid: u32,
    exited: AtomicBool,
    #[cfg(windows)]
    job: Mutex<Option<windows::OwnedJob>>,
}

#[napi]
pub struct NativeManagedProcess {
    state: Arc<ManagedState>,
    metadata: NativeProcessMetadata,
}

#[napi]
impl NativeManagedProcess {
    #[napi(getter)]
    pub fn pid(&self) -> u32 {
        self.metadata.pid
    }

    #[napi(getter)]
    pub fn identity(&self) -> String {
        self.metadata.identity.clone()
    }

    #[napi(getter)]
    pub fn containment(&self) -> String {
        self.metadata.containment.clone()
    }

    #[napi]
    pub fn terminate(&self, signal: Option<String>) -> Result<bool> {
        if self.state.exited.load(Ordering::Acquire) {
            return Ok(false);
        }
        terminate_state(&self.state, signal.as_deref().unwrap_or("SIGKILL"))
    }
}

#[napi]
pub fn inspect_process(pid: u32) -> Option<String> {
    inspected_process_identity(pid)
}

#[napi]
pub fn runtime_capabilities() -> Vec<String> {
    let mut capabilities = vec![
        "managed-process".to_string(),
        "process-identity".to_string(),
    ];
    #[cfg(windows)]
    capabilities.push("job-object".to_string());
    #[cfg(unix)]
    capabilities.push("process-group".to_string());
    capabilities
}

#[napi]
pub fn spawn_managed_process(
    command: String,
    args: Vec<String>,
    options: NativeSpawnOptions,
    stdout_callback: ThreadsafeFunction<Buffer>,
    stderr_callback: ThreadsafeFunction<Buffer>,
    exit_callback: ThreadsafeFunction<(i32, String)>,
) -> Result<NativeManagedProcess> {
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

    #[cfg(unix)]
    process.process_group(0);

    #[cfg(windows)]
    let (mut child, job) = windows::spawn_suspended_in_job(&mut process)?;
    #[cfg(not(windows))]
    let mut child = process
        .spawn()
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;

    let pid = child.id();
    let identity = process_identity(pid);
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let state = Arc::new(ManagedState {
        #[cfg(unix)]
        pid,
        exited: AtomicBool::new(false),
        #[cfg(windows)]
        job: Mutex::new(Some(job)),
    });

    let mut output_threads = Vec::new();
    if let Some(stdout) = stdout {
        output_threads.push(relay_output(stdout, stdout_callback));
    }
    if let Some(stderr) = stderr {
        output_threads.push(relay_output(stderr, stderr_callback));
    }

    let wait_state = Arc::clone(&state);
    thread::spawn(move || {
        let (code, signal) = match child.wait() {
            Ok(status) => exit_parts(status),
            Err(error) => (-1, error.to_string()),
        };
        for output_thread in output_threads {
            let _ = output_thread.join();
        }
        wait_state.exited.store(true, Ordering::Release);
        #[cfg(windows)]
        {
            let _ = wait_state.job.lock().map(|mut job| job.take());
        }
        exit_callback.call(Ok((code, signal)), ThreadsafeFunctionCallMode::NonBlocking);
    });

    Ok(NativeManagedProcess {
        state,
        metadata: NativeProcessMetadata {
            pid,
            identity,
            containment: if cfg!(windows) {
                "job-object".to_string()
            } else {
                "process-group".to_string()
            },
        },
    })
}

fn relay_output<R: Read + Send + 'static>(
    mut reader: R,
    callback: ThreadsafeFunction<Buffer>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => {
                    callback.call(
                        Ok(Buffer::from(buffer[..length].to_vec())),
                        ThreadsafeFunctionCallMode::Blocking,
                    );
                }
                Err(_) => break,
            }
        }
    })
}

fn terminate_state(state: &ManagedState, signal: &str) -> Result<bool> {
    #[cfg(windows)]
    {
        let _ = signal;
        let job = state
            .job
            .lock()
            .map_err(|_| napi::Error::from_reason("Windows Job lock was poisoned"))?;
        let Some(job) = job.as_ref() else {
            return Ok(false);
        };
        job.terminate()
    }

    #[cfg(unix)]
    {
        let signal = match signal {
            "SIGTERM" => libc::SIGTERM,
            "SIGINT" => libc::SIGINT,
            "SIGHUP" => libc::SIGHUP,
            _ => libc::SIGKILL,
        };
        let result = unsafe { libc::kill(-(state.pid as i32), signal) };
        if result == 0 {
            Ok(true)
        } else {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                Ok(false)
            } else {
                Err(napi::Error::from_reason(error.to_string()))
            }
        }
    }
}

fn inspected_process_identity(pid: u32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
        let close = stat.rfind(')')?;
        let start = stat[close + 1..].split_whitespace().nth(19)?;
        return Some(format!("linux:{start}"));
    }
    #[cfg(windows)]
    {
        return windows::process_creation_time(pid)
            .ok()
            .map(|identity| format!("win32:{identity}"));
    }
    #[cfg(target_os = "macos")]
    {
        let alive = unsafe { libc::kill(pid as i32, 0) } == 0;
        return alive.then(|| format!("darwin:{pid}"));
    }
    #[allow(unreachable_code)]
    None
}

fn process_identity(pid: u32) -> String {
    if let Some(identity) = inspected_process_identity(pid) {
        return identity;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    format!("pid:{pid}:{now}")
}

#[cfg(unix)]
fn exit_parts(status: std::process::ExitStatus) -> (i32, String) {
    use std::os::unix::process::ExitStatusExt;
    (
        status.code().unwrap_or(-1),
        status
            .signal()
            .map(|signal| signal.to_string())
            .unwrap_or_default(),
    )
}

#[cfg(windows)]
fn exit_parts(status: std::process::ExitStatus) -> (i32, String) {
    (status.code().unwrap_or(-1), String::new())
}
