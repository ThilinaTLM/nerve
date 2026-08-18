#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
pub(crate) mod windows;

use crate::{NativeInspectionResult, NativeManagedTarget, NativeTerminationResult};

pub(crate) fn capabilities() -> Vec<String> {
    let mut values = vec![
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

pub(crate) fn identity(pid: u32) -> Result<String, String> {
    platform_identity(pid)
}

pub(crate) fn inspect(target: &NativeManagedTarget) -> NativeInspectionResult {
    platform_inspect(target)
}

pub(crate) fn terminate(target: &NativeManagedTarget, signal: &str) -> NativeTerminationResult {
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

#[cfg(unix)]
pub(crate) fn posix_signal(signal: &str) -> Result<i32, String> {
    match signal {
        "SIGKILL" => Ok(libc::SIGKILL),
        "SIGTERM" => Ok(libc::SIGTERM),
        "SIGINT" => Ok(libc::SIGINT),
        "SIGHUP" => Ok(libc::SIGHUP),
        _ => Err(format!("Unsupported managed-process signal: {signal}")),
    }
}

#[cfg(unix)]
pub(crate) fn signal_target(target: &NativeManagedTarget, signal: &str) -> NativeTerminationResult {
    let method = if target.process_group_id.is_some() {
        "process-group"
    } else {
        "direct-child"
    };
    let signal = match posix_signal(signal) {
        Ok(signal) => signal,
        Err(error) => return NativeTerminationResult::not_attempted(method, Some(error)),
    };
    let pid = target
        .process_group_id
        .map(|group| -(group as i32))
        .unwrap_or(target.pid as i32);
    let result = unsafe { libc::kill(pid, signal) };
    if result == 0 {
        return NativeTerminationResult::terminated(method);
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        NativeTerminationResult::not_attempted("none", None)
    } else {
        NativeTerminationResult::failed(method, error.to_string())
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
