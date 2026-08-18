use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::Arc;
#[cfg(windows)]
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;

use napi::bindgen_prelude::{Buffer, Result};
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

#[cfg(unix)]
use std::os::unix::process::CommandExt;

use crate::platform;
use crate::{NativeManagedTarget, NativeSpawnOptions, NativeTerminationResult};

struct ManagedState {
    target: NativeManagedTarget,
    exited: AtomicBool,
    #[cfg(windows)]
    job: Mutex<Option<platform::windows::OwnedJob>>,
}

#[napi]
pub struct NativeManagedProcess {
    state: Arc<ManagedState>,
}

#[napi]
impl NativeManagedProcess {
    #[napi(getter)]
    pub fn pid(&self) -> u32 {
        self.state.target.pid
    }

    #[napi(getter)]
    pub fn identity(&self) -> String {
        self.state.target.identity.clone()
    }

    #[napi(getter)]
    pub fn containment(&self) -> String {
        self.state.target.containment.clone()
    }

    #[napi(getter)]
    pub fn process_group_id(&self) -> Option<u32> {
        self.state.target.process_group_id
    }

    #[napi(getter)]
    pub fn target(&self) -> NativeManagedTarget {
        self.state.target.clone()
    }

    #[napi]
    pub fn terminate(&self, signal: Option<String>) -> NativeTerminationResult {
        if self.state.exited.load(Ordering::Acquire) {
            return NativeTerminationResult::not_attempted("none", None);
        }
        #[cfg(windows)]
        {
            let job = match self.state.job.lock() {
                Ok(job) => job,
                Err(_) => {
                    return NativeTerminationResult::failed(
                        "job-object",
                        "Windows Job lock was poisoned",
                    );
                }
            };
            if let Some(job) = job.as_ref() {
                return job.terminate();
            }
        }
        platform::terminate(&self.state.target, signal.as_deref().unwrap_or("SIGKILL"))
    }
}

pub(crate) fn spawn(
    command: String,
    args: Vec<String>,
    options: NativeSpawnOptions,
    stdout_callback: ThreadsafeFunction<Buffer>,
    stderr_callback: ThreadsafeFunction<Buffer>,
    exit_callback: ThreadsafeFunction<(i32, String)>,
    close_callback: ThreadsafeFunction<(i32, String)>,
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
    let (mut child, job) = platform::windows::spawn_suspended_in_job(&mut process)?;
    #[cfg(not(windows))]
    let mut child = process
        .spawn()
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;

    let pid = child.id();
    let identity = match platform::identity(pid) {
        Ok(identity) => identity,
        Err(error) => {
            #[cfg(windows)]
            let _ = job.terminate();
            #[cfg(unix)]
            unsafe {
                libc::kill(-(pid as i32), libc::SIGKILL);
            }
            let _ = child.wait();
            return Err(napi::Error::from_reason(error));
        }
    };
    let target = NativeManagedTarget {
        pid,
        process_group_id: if cfg!(unix) { Some(pid) } else { None },
        containment: if cfg!(windows) {
            "job-object".to_string()
        } else {
            "process-group".to_string()
        },
        identity,
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let state = Arc::new(ManagedState {
        target,
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
        let result = match child.wait() {
            Ok(status) => exit_parts(status),
            Err(error) => (-1, error.to_string()),
        };
        wait_state.exited.store(true, Ordering::Release);
        exit_callback.call(
            Ok((result.0, result.1.clone())),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
        #[cfg(windows)]
        {
            // Closing the kill-on-close Job after the root exits prevents descendants
            // from keeping inherited pipes open forever.
            let _ = wait_state.job.lock().map(|mut job| job.take());
        }
        for output_thread in output_threads {
            let _ = output_thread.join();
        }
        close_callback.call(Ok(result), ThreadsafeFunctionCallMode::NonBlocking);
    });

    Ok(NativeManagedProcess { state })
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

#[cfg(unix)]
fn exit_parts(status: std::process::ExitStatus) -> (i32, String) {
    use std::os::unix::process::ExitStatusExt;
    let signal = status.signal().map(signal_name).unwrap_or_default();
    (status.code().unwrap_or(-1), signal)
}

#[cfg(unix)]
fn signal_name(signal: i32) -> String {
    match signal {
        libc::SIGKILL => "SIGKILL".to_string(),
        libc::SIGTERM => "SIGTERM".to_string(),
        libc::SIGINT => "SIGINT".to_string(),
        libc::SIGHUP => "SIGHUP".to_string(),
        _ => signal.to_string(),
    }
}

#[cfg(windows)]
fn exit_parts(status: std::process::ExitStatus) -> (i32, String) {
    (status.code().unwrap_or(-1), String::new())
}
