#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

use std::process::{Child, Command, ExitStatus};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[cfg(unix)]
use crate::process::TerminationMethod;
use crate::process::{
    Containment, InspectionResult, ManagedTarget, ProcessPriority, TerminationResult,
};

pub struct SpawnedChild {
    pub child: Child,
    pub target: ManagedTarget,
    pub containment_guard: ContainmentGuard,
}

#[cfg(unix)]
pub struct ContainmentGuard;

#[cfg(windows)]
pub struct ContainmentGuard(windows::OwnedJob);

impl ContainmentGuard {
    pub fn terminate(&self) -> Option<TerminationResult> {
        #[cfg(unix)]
        {
            None
        }
        #[cfg(windows)]
        {
            Some(self.0.terminate())
        }
    }
}

pub fn capabilities() -> Vec<String> {
    let mut values = vec![
        "process-priority".to_string(),
        "managed-process".to_string(),
        "stable-process-identity".to_string(),
        "serialized-inspection".to_string(),
        "serialized-termination".to_string(),
        "process-tree-termination".to_string(),
        "native-pipe-lifecycle".to_string(),
    ];
    #[cfg(unix)]
    {
        values.push("process-group".to_string());
        values.push("posix-signals".to_string());
    }
    #[cfg(windows)]
    values.push("job-object".to_string());
    values
}

pub fn spawn_contained(
    process: &mut Command,
    priority: ProcessPriority,
) -> Result<SpawnedChild, String> {
    #[cfg(unix)]
    {
        process.process_group(0);
        if priority == ProcessPriority::BelowNormal {
            // SAFETY: setpriority is async-signal-safe and the closure captures no
            // heap-backed state. Applying it before exec prevents user code from
            // racing the priority change.
            unsafe {
                process.pre_exec(|| {
                    if libc::setpriority(libc::PRIO_PROCESS, 0, 10) == 0 {
                        Ok(())
                    } else {
                        Err(std::io::Error::last_os_error())
                    }
                });
            }
        }
        let mut child = process.spawn().map_err(|error| error.to_string())?;
        let pid = child.id();
        let identity = match identity(pid) {
            Ok(identity) => identity,
            Err(error) => {
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
                let _ = child.wait();
                return Err(error);
            }
        };
        Ok(SpawnedChild {
            child,
            target: ManagedTarget {
                pid,
                process_group_id: Some(pid),
                containment: Containment::ProcessGroup,
                identity,
            },
            containment_guard: ContainmentGuard,
        })
    }
    #[cfg(windows)]
    {
        let (mut child, job) = windows::spawn_suspended_in_job(process, priority)?;
        let pid = child.id();
        let identity = match identity(pid) {
            Ok(identity) => identity,
            Err(error) => {
                let _ = job.terminate();
                let _ = child.wait();
                return Err(error);
            }
        };
        Ok(SpawnedChild {
            child,
            target: ManagedTarget {
                pid,
                process_group_id: None,
                containment: Containment::JobObject,
                identity,
            },
            containment_guard: ContainmentGuard(job),
        })
    }
}

pub fn inspect(target: &ManagedTarget) -> InspectionResult {
    platform_inspect(target)
}

pub fn terminate(target: &ManagedTarget, signal: &str) -> TerminationResult {
    platform_terminate(target, signal)
}

#[cfg(target_os = "linux")]
use linux::{
    identity as platform_identity, inspect as platform_inspect, terminate as platform_terminate,
};
#[cfg(target_os = "macos")]
use macos::{
    identity as platform_identity, inspect as platform_inspect, terminate as platform_terminate,
};
#[cfg(windows)]
use windows::{
    identity as platform_identity, inspect as platform_inspect, terminate as platform_terminate,
};

fn identity(pid: u32) -> Result<String, String> {
    platform_identity(pid)
}

#[cfg(unix)]
fn posix_signal(signal: &str) -> Result<i32, String> {
    match signal {
        "SIGKILL" => Ok(libc::SIGKILL),
        "SIGTERM" => Ok(libc::SIGTERM),
        "SIGINT" => Ok(libc::SIGINT),
        "SIGHUP" => Ok(libc::SIGHUP),
        _ => Err(format!("Unsupported managed-process signal: {signal}")),
    }
}

#[cfg(unix)]
pub(super) fn signal_target(target: &ManagedTarget, signal: &str) -> TerminationResult {
    let method = if target.process_group_id.is_some() {
        TerminationMethod::ProcessGroup
    } else {
        TerminationMethod::DirectChild
    };
    let signal = match posix_signal(signal) {
        Ok(signal) => signal,
        Err(error) => return TerminationResult::not_attempted(method, Some(error)),
    };
    let pid = target
        .process_group_id
        .map(|group| -(group as i32))
        .unwrap_or(target.pid as i32);
    let result = unsafe { libc::kill(pid, signal) };
    if result == 0 {
        return TerminationResult::terminated(method);
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        TerminationResult::not_attempted(TerminationMethod::None, None)
    } else {
        TerminationResult::failed(method, error.to_string())
    }
}

pub fn exit_parts(status: ExitStatus) -> (i32, String) {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        let signal = status.signal().map(signal_name).unwrap_or_default();
        (status.code().unwrap_or(-1), signal)
    }
    #[cfg(windows)]
    {
        (status.code().unwrap_or(-1), String::new())
    }
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

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn translates_supported_posix_signals() {
        assert_eq!(super::posix_signal("SIGTERM"), Ok(libc::SIGTERM));
        assert!(super::posix_signal("SIGUSR1").is_err());
    }
}
