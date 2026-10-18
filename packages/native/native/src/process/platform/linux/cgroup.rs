use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::fd::AsRawFd;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};

use std::os::unix::process::CommandExt;
use tokio::process::Command;

use crate::process::{EnforcementEntry, ExitReason, ResourcePolicy};

static NEXT_GROUP: AtomicU64 = AtomicU64::new(1);
static MANAGED_ROOT: OnceLock<PathBuf> = OnceLock::new();
const REQUIRED_CONTROLLERS: [&str; 3] = ["cpu", "memory", "pids"];

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

pub(crate) fn initialize_managed_root(delegated_scope: bool) -> Result<PathBuf, String> {
    if let Some(root) = MANAGED_ROOT.get() {
        return Ok(root.clone());
    }

    let root = if let Some(explicit) = std::env::var_os("NERVE_CGROUP_ROOT") {
        let root = writable_directory(PathBuf::from(explicit))?;
        verify_enabled_controllers(&root, &REQUIRED_CONTROLLERS)?;
        root
    } else if delegated_scope {
        bootstrap_delegated_scope()?
    } else {
        return Err("Linux hard resource limits require a delegated cgroup v2 root".to_string());
    };

    let _ = MANAGED_ROOT.set(root.clone());
    Ok(root)
}

pub(crate) fn prepare(
    process: &mut Command,
    policy: &ResourcePolicy,
) -> Result<(CgroupGuard, Vec<EnforcementEntry>), String> {
    let parent = delegated_parent()?;
    verify_requested_controllers(&parent, policy)?;
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

fn bootstrap_delegated_scope() -> Result<PathBuf, String> {
    let membership = unified_membership()?;
    let root =
        writable_directory(Path::new("/sys/fs/cgroup").join(membership.trim_start_matches('/')))?;
    verify_available_controllers(&root, &REQUIRED_CONTROLLERS)?;

    let control = root.join("control");
    fs::create_dir(&control).map_err(|error| {
        format!(
            "Could not create daemon control cgroup {}: {error}",
            control.display()
        )
    })?;
    write_value(control.join("cgroup.procs"), "0")?;
    let remaining = fs::read_to_string(root.join("cgroup.procs"))
        .map_err(|error| format!("Could not verify delegated cgroup root: {error}"))?;
    if !remaining.trim().is_empty() {
        return Err(format!(
            "Delegated cgroup root {} still contains processes after moving the daemon",
            root.display()
        ));
    }
    write_value(root.join("cgroup.subtree_control"), "+cpu +memory +pids")?;
    verify_enabled_controllers(&root, &REQUIRED_CONTROLLERS)?;
    Ok(root)
}

fn configure(path: &Path, policy: &ResourcePolicy) -> Result<Vec<EnforcementEntry>, String> {
    let mut entries = Vec::new();
    if let Some(memory) = policy.memory_bytes {
        write_and_verify(path.join("memory.max"), &memory.to_string())?;
        let swap_limit = path.join("memory.swap.max");
        if swap_limit.exists() {
            write_and_verify(swap_limit, "0")?;
        }
        entries.push(enforced("memory", "cgroup-v2-memory"));
    }
    if let Some(processes) = policy.max_processes {
        write_and_verify(path.join("pids.max"), &processes.to_string())?;
        entries.push(enforced("processes", "cgroup-v2-pids"));
    }
    if let Some(cores) = policy.max_cpu_cores {
        let period = 100_000_u64;
        let quota = (cores * period as f64).ceil().max(1.0) as u64;
        write_and_verify(path.join("cpu.max"), &format!("{quota} {period}"))?;
        entries.push(enforced("cpu", "cgroup-v2-cpu"));
    }
    Ok(entries)
}

fn delegated_parent() -> Result<PathBuf, String> {
    if let Some(root) = MANAGED_ROOT.get() {
        return Ok(root.clone());
    }
    if let Some(explicit) = std::env::var_os("NERVE_CGROUP_ROOT") {
        return writable_directory(PathBuf::from(explicit));
    }
    let relative = unified_membership()?;
    writable_directory(Path::new("/sys/fs/cgroup").join(relative.trim_start_matches('/')))
}

fn unified_membership() -> Result<String, String> {
    let membership = fs::read_to_string("/proc/self/cgroup")
        .map_err(|error| format!("Could not read /proc/self/cgroup: {error}"))?;
    membership
        .lines()
        .find_map(|line| line.strip_prefix("0::"))
        .map(str::to_string)
        .ok_or_else(|| "Unified cgroup v2 membership was not found".to_string())
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

fn controller_set(path: &Path) -> Result<Vec<String>, String> {
    fs::read_to_string(path)
        .map_err(|error| format!("Could not read {}: {error}", path.display()))
        .map(|value| value.split_whitespace().map(str::to_string).collect())
}

fn verify_available_controllers(root: &Path, requested: &[&str]) -> Result<(), String> {
    let available = controller_set(&root.join("cgroup.controllers"))?;
    let missing: Vec<_> = requested
        .iter()
        .filter(|controller| !available.iter().any(|value| value == **controller))
        .copied()
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Cgroup {} does not provide requested controllers: {}",
            root.display(),
            missing.join(", ")
        ))
    }
}

fn verify_enabled_controllers(root: &Path, requested: &[&str]) -> Result<(), String> {
    verify_available_controllers(root, requested)?;
    let enabled = controller_set(&root.join("cgroup.subtree_control"))?;
    let missing: Vec<_> = requested
        .iter()
        .filter(|controller| !enabled.iter().any(|value| value == **controller))
        .copied()
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Cgroup {} has requested controllers available but not enabled for children: {}",
            root.display(),
            missing.join(", ")
        ))
    }
}

fn verify_requested_controllers(root: &Path, policy: &ResourcePolicy) -> Result<(), String> {
    let mut requested = Vec::new();
    if policy.max_cpu_cores.is_some() {
        requested.push("cpu");
    }
    if policy.memory_bytes.is_some() {
        requested.push("memory");
    }
    if policy.max_processes.is_some() {
        requested.push("pids");
    }
    verify_enabled_controllers(root, &requested)
}

fn write_value(path: PathBuf, value: &str) -> Result<(), String> {
    fs::write(&path, value)
        .map_err(|error| format!("Could not write {} to {}: {error}", value, path.display()))
}

fn write_and_verify(path: PathBuf, value: &str) -> Result<(), String> {
    write_value(path.clone(), value)?;
    let actual = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read back {}: {error}", path.display()))?;
    if actual.trim() != value {
        return Err(format!(
            "Resource limit readback mismatch at {}: expected {value}, got {}",
            path.display(),
            actual.trim()
        ));
    }
    Ok(())
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
