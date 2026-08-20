use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use std::os::unix::process::CommandExt;
use tokio::process::Command;

use crate::process::{EnforcementEntry, ExitReason, ResourcePolicy};

static NEXT_GROUP: AtomicU64 = AtomicU64::new(1);

pub(crate) struct CgroupGuard {
    path: PathBuf,
}

impl CgroupGuard {
    pub(crate) fn release(self) {}

    pub(crate) fn exit_reason(&self) -> Option<ExitReason> {
        if event_count(&self.path.join("memory.events"), "oom_kill") > 0 {
            return Some(ExitReason::MemoryLimit);
        }
        if event_count(&self.path.join("pids.events"), "max") > 0 {
            return Some(ExitReason::ProcessLimit);
        }
        None
    }
}

impl Drop for CgroupGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir(&self.path);
    }
}

pub(crate) fn prepare(
    process: &mut Command,
    policy: &ResourcePolicy,
) -> Result<(CgroupGuard, Vec<EnforcementEntry>), String> {
    let parent = delegated_parent()?;
    let path = parent.join(format!(
        "nerve-{}-{}",
        std::process::id(),
        NEXT_GROUP.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&path).map_err(|error| {
        format!(
            "Could not create delegated cgroup {}: {error}",
            path.display()
        )
    })?;
    let result = configure(&path, policy).and_then(|entries| {
        let membership = Arc::new(
            OpenOptions::new()
                .write(true)
                .open(path.join("cgroup.procs"))
                .map_err(|error| format!("Could not open cgroup.procs: {error}"))?,
        );
        let child_membership = Arc::clone(&membership);
        unsafe {
            process.as_std_mut().pre_exec(move || {
                let value = b"0";
                let written = libc::write(
                    child_membership.as_raw_fd(),
                    value.as_ptr().cast(),
                    value.len(),
                );
                if written == value.len() as isize {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
        Ok((CgroupGuard { path: path.clone() }, entries))
    });
    if result.is_err() {
        let _ = fs::remove_dir(&path);
    }
    result
}

fn configure(path: &Path, policy: &ResourcePolicy) -> Result<Vec<EnforcementEntry>, String> {
    let mut entries = Vec::new();
    if let Some(memory) = policy.memory_bytes {
        write_value(path.join("memory.max"), &memory.to_string())?;
        let swap_limit = path.join("memory.swap.max");
        if swap_limit.exists() {
            write_value(swap_limit, "0")?;
        }
        entries.push(enforced("memory", "cgroup-v2-memory"));
    }
    if let Some(processes) = policy.max_processes {
        write_value(path.join("pids.max"), &processes.to_string())?;
        entries.push(enforced("processes", "cgroup-v2-pids"));
    }
    if let Some(cores) = policy.max_cpu_cores {
        let period = 100_000_u64;
        let quota = (cores * period as f64).ceil().max(1.0) as u64;
        write_value(path.join("cpu.max"), &format!("{quota} {period}"))?;
        entries.push(enforced("cpu", "cgroup-v2-cpu"));
    }
    Ok(entries)
}

fn delegated_parent() -> Result<PathBuf, String> {
    if let Some(explicit) = std::env::var_os("NERVE_CGROUP_ROOT") {
        return writable_directory(PathBuf::from(explicit));
    }
    let membership = fs::read_to_string("/proc/self/cgroup")
        .map_err(|error| format!("Could not read /proc/self/cgroup: {error}"))?;
    let relative = membership
        .lines()
        .find_map(|line| line.strip_prefix("0::"))
        .ok_or_else(|| "Unified cgroup v2 membership was not found".to_string())?;
    writable_directory(Path::new("/sys/fs/cgroup").join(relative.trim_start_matches('/')))
}

fn writable_directory(path: PathBuf) -> Result<PathBuf, String> {
    if !path.join("cgroup.controllers").is_file() {
        return Err(format!("{} is not a cgroup v2 directory", path.display()));
    }
    let mut probe = OpenOptions::new()
        .write(true)
        .open(path.join("cgroup.procs"))
        .map_err(|error| format!("Cgroup {} is not delegated: {error}", path.display()))?;
    probe
        .flush()
        .map_err(|error| format!("Cgroup {} is not writable: {error}", path.display()))?;
    Ok(path)
}

fn write_value(path: PathBuf, value: &str) -> Result<(), String> {
    fs::write(&path, value)
        .map_err(|error| format!("Could not write {} to {}: {error}", value, path.display()))
}

fn event_count(path: &Path, name: &str) -> u64 {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| {
            contents.lines().find_map(|line| {
                let (key, value) = line.split_once(' ')?;
                (key == name).then(|| value.parse().ok()).flatten()
            })
        })
        .unwrap_or(0)
}

fn enforced(resource: &str, method: &str) -> EnforcementEntry {
    EnforcementEntry {
        resource: resource.to_string(),
        status: "enforced".to_string(),
        method: method.to_string(),
        detail: None,
    }
}
