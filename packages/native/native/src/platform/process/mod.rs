#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

use std::process::ExitStatus;

use tokio::process::{Child, Command};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

#[cfg(unix)]
use crate::process::EnforcementMode;
use crate::process::{
    Containment, EnforcementEntry, ExitReason, InspectionResult, ManagedTarget, ResourcePolicy,
    TerminationMethod, TerminationResult,
};

#[derive(Clone, Debug)]
pub(crate) struct TcpListenerInfo {
    pub(crate) protocol: &'static str,
    pub(crate) address: String,
    pub(crate) port: u16,
    pub(crate) pid: u32,
    pub(crate) process_group_id: Option<u32>,
    pub(crate) identity: String,
    pub(crate) process_name: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct ManagedProcessHostStatus {
    pub(crate) backend: String,
    pub(crate) hard_limits_available: bool,
    pub(crate) enforcement: String,
    pub(crate) detail: Option<String>,
}

pub(crate) fn initialize_managed_process_host(
    delegated_scope: bool,
    allow_uncontained: bool,
) -> Result<ManagedProcessHostStatus, String> {
    #[cfg(target_os = "linux")]
    {
        match linux::initialize_managed_root(delegated_scope) {
            Ok(root) => Ok(ManagedProcessHostStatus {
                backend: "cgroup_v2".to_string(),
                hard_limits_available: true,
                enforcement: "required".to_string(),
                detail: Some(root.display().to_string()),
            }),
            Err(error) if allow_uncontained => Ok(ManagedProcessHostStatus {
                backend: "process_group".to_string(),
                hard_limits_available: false,
                enforcement: "best_effort".to_string(),
                detail: Some(error),
            }),
            Err(error) => Err(error),
        }
    }
    #[cfg(windows)]
    {
        let _ = (delegated_scope, allow_uncontained);
        Ok(ManagedProcessHostStatus {
            backend: "windows_job".to_string(),
            hard_limits_available: true,
            enforcement: "required".to_string(),
            detail: None,
        })
    }
    #[cfg(target_os = "macos")]
    {
        let _ = (delegated_scope, allow_uncontained);
        Ok(ManagedProcessHostStatus {
            backend: "process_group".to_string(),
            hard_limits_available: false,
            enforcement: "best_effort".to_string(),
            detail: Some(
                "macOS does not provide tree-wide CPU, memory, and process-count limits"
                    .to_string(),
            ),
        })
    }
}

pub(crate) struct SpawnedChild {
    pub(crate) child: Child,
    pub(crate) target: ManagedTarget,
    pub(crate) containment_guard: ContainmentGuard,
}

#[cfg(target_os = "linux")]
pub(crate) struct ContainmentGuard(Option<linux::CgroupGuard>);

#[cfg(target_os = "macos")]
pub(crate) struct ContainmentGuard;

#[cfg(windows)]
pub(crate) struct ContainmentGuard(windows::OwnedJob);

impl ContainmentGuard {
    pub(crate) fn terminate(
        &self,
        target: &ManagedTarget,
        signal: &str,
    ) -> Option<TerminationResult> {
        #[cfg(unix)]
        {
            Some(signal_target(target, signal))
        }
        #[cfg(windows)]
        {
            let _ = (target, signal);
            Some(self.0.terminate())
        }
    }

    pub(crate) fn exit_reason(&self) -> Option<ExitReason> {
        #[cfg(target_os = "linux")]
        {
            self.0.as_ref().and_then(linux::CgroupGuard::exit_reason)
        }
        #[cfg(not(target_os = "linux"))]
        {
            None
        }
    }

    pub(crate) fn release(self) {
        #[cfg(target_os = "linux")]
        if let Some(cgroup) = self.0 {
            cgroup.release();
        }
    }
}

pub(crate) fn capabilities() -> Vec<String> {
    let mut values = vec![
        "managed-process".to_string(),
        "stable-process-identity".to_string(),
        "serialized-inspection".to_string(),
        "serialized-termination".to_string(),
        "process-tree-termination".to_string(),
        "native-pipe-lifecycle".to_string(),
        "bounded-output-queue".to_string(),
        "async-process-io".to_string(),
        "managed-resource-policy".to_string(),
        "tcp-listener-inspection".to_string(),
        "tcp-listener-termination".to_string(),
    ];
    #[cfg(unix)]
    {
        values.push("process-group".to_string());
        values.push("posix-signals".to_string());
    }
    #[cfg(target_os = "linux")]
    values.push("cgroup-v2".to_string());
    #[cfg(windows)]
    {
        values.push("job-object".to_string());
        values.push("job-object-resource-limits".to_string());
    }
    values
}

pub(crate) fn spawn_contained(
    process: &mut Command,
    policy: &ResourcePolicy,
) -> Result<(SpawnedChild, Vec<EnforcementEntry>), String> {
    #[cfg(unix)]
    {
        let resources = prepare_resource_limits(process, policy)?;
        process.as_std_mut().process_group(0);
        let mut child = process.spawn().map_err(|error| error.to_string())?;
        let pid = child
            .id()
            .ok_or_else(|| "Spawned process did not expose a PID".to_string())?;
        let identity = match identity(pid) {
            Ok(identity) => identity,
            Err(error) => {
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
                let _ = child.start_kill();
                return Err(error);
            }
        };
        Ok((
            SpawnedChild {
                child,
                target: ManagedTarget {
                    pid,
                    process_group_id: Some(pid),
                    containment: Containment::ProcessGroup,
                    identity,
                },
                #[cfg(target_os = "linux")]
                containment_guard: ContainmentGuard(resources.cgroup),
                #[cfg(target_os = "macos")]
                containment_guard: ContainmentGuard,
            },
            resources.enforcement,
        ))
    }
    #[cfg(windows)]
    {
        let (mut child, job, enforcement) = windows::spawn_suspended_in_job(process, policy)?;
        let pid = child
            .id()
            .ok_or_else(|| "Spawned process did not expose a PID".to_string())?;
        let identity = match identity(pid) {
            Ok(identity) => identity,
            Err(error) => {
                let _ = job.terminate();
                let _ = child.start_kill();
                return Err(error);
            }
        };
        Ok((
            SpawnedChild {
                child,
                target: ManagedTarget {
                    pid,
                    process_group_id: None,
                    containment: Containment::JobObject,
                    identity,
                },
                containment_guard: ContainmentGuard(job),
            },
            enforcement,
        ))
    }
}

#[cfg(unix)]
struct PreparedResources {
    enforcement: Vec<EnforcementEntry>,
    #[cfg(target_os = "linux")]
    cgroup: Option<linux::CgroupGuard>,
}

#[cfg(unix)]
fn prepare_resource_limits(
    _process: &mut Command,
    policy: &ResourcePolicy,
) -> Result<PreparedResources, String> {
    #[cfg(target_os = "linux")]
    let backend_error = if policy.memory_bytes.is_some()
        || policy.max_cpu_cores.is_some()
        || policy.max_processes.is_some()
    {
        match linux::prepare_cgroup(_process, policy) {
            Ok((cgroup, enforcement)) => {
                return Ok(PreparedResources {
                    enforcement,
                    cgroup: Some(cgroup),
                });
            }
            Err(error) if policy.enforcement == EnforcementMode::Required => return Err(error),
            Err(error) => Some(error),
        }
    } else {
        None
    };
    #[cfg(target_os = "macos")]
    let backend_error: Option<String> = None;

    let mut entries = Vec::new();
    record_unsupported(
        &mut entries,
        policy.enforcement,
        policy.memory_bytes.is_some(),
        "memory",
        backend_error.as_deref().unwrap_or(
            "RLIMIT_AS constrains virtual address reservations and is not a safe RSS fallback",
        ),
    )?;
    record_unsupported(
        &mut entries,
        policy.enforcement,
        policy.max_processes.is_some(),
        "processes",
        backend_error
            .as_deref()
            .unwrap_or("RLIMIT_NPROC is user-wide and is not a safe process-tree fallback"),
    )?;
    record_unsupported(
        &mut entries,
        policy.enforcement,
        policy.max_cpu_cores.is_some(),
        "cpu",
        backend_error
            .as_deref()
            .unwrap_or("CPU rate limits require a delegated cgroup or platform watchdog"),
    )?;
    Ok(PreparedResources {
        enforcement: entries,
        #[cfg(target_os = "linux")]
        cgroup: None,
    })
}

#[cfg(unix)]
fn record_unsupported(
    entries: &mut Vec<EnforcementEntry>,
    mode: EnforcementMode,
    requested: bool,
    resource: &str,
    detail: &str,
) -> Result<(), String> {
    if !requested {
        return Ok(());
    }
    if mode == EnforcementMode::Required {
        return Err(detail.to_string());
    }
    entries.push(EnforcementEntry {
        resource: resource.to_string(),
        status: "unsupported".to_string(),
        method: "none".to_string(),
        detail: Some(detail.to_string()),
    });
    Ok(())
}

pub(crate) fn inspect(target: &ManagedTarget) -> InspectionResult {
    platform_inspect(target)
}

pub(crate) fn terminate(target: &ManagedTarget, signal: &str) -> TerminationResult {
    platform_terminate(target, signal)
}

pub(crate) fn inspect_tcp_listeners(port: Option<u16>) -> Result<Vec<TcpListenerInfo>, String> {
    platform_inspect_tcp_listeners(port)
}

pub(crate) fn terminate_tcp_listener(
    listener: &TcpListenerInfo,
    signal: &str,
) -> TerminationResult {
    let current = match platform_inspect_tcp_listeners(Some(listener.port)) {
        Ok(current) => current,
        Err(error) => {
            return TerminationResult::not_attempted(TerminationMethod::None, Some(error));
        }
    };
    if !current.iter().any(|candidate| {
        candidate.pid == listener.pid
            && candidate.identity == listener.identity
            && candidate.port == listener.port
    }) {
        return TerminationResult::not_attempted(
            TerminationMethod::None,
            Some("TCP listener identity no longer matches".to_string()),
        );
    }
    platform_terminate(
        &ManagedTarget {
            pid: listener.pid,
            process_group_id: None,
            containment: Containment::ProcessGroup,
            identity: listener.identity.clone(),
        },
        signal,
    )
}

#[cfg(target_os = "linux")]
use linux::inspect_tcp_listeners as platform_inspect_tcp_listeners;
#[cfg(target_os = "linux")]
use linux::{
    identity as platform_identity, inspect as platform_inspect, terminate as platform_terminate,
};
#[cfg(target_os = "macos")]
use macos::inspect_tcp_listeners as platform_inspect_tcp_listeners;
#[cfg(target_os = "macos")]
use macos::{
    identity as platform_identity, inspect as platform_inspect, terminate as platform_terminate,
};
#[cfg(windows)]
use windows::inspect_tcp_listeners as platform_inspect_tcp_listeners;
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

pub(crate) fn exit_parts(status: ExitStatus) -> (i32, String) {
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
