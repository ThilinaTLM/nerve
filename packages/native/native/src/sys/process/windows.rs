use std::collections::{HashMap, HashSet};
use std::ffi::c_void;
use std::mem::size_of;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};

use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
    TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, GetExitCodeProcess, GetProcessTimes, OpenProcess,
    OpenThread, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE, ResumeThread,
    THREAD_SUSPEND_RESUME, TerminateProcess,
};

use crate::process::{InspectionResult, ManagedTarget, TerminationMethod, TerminationResult};

const ERROR_ACCESS_DENIED: i32 = 5;
const ERROR_INVALID_PARAMETER: i32 = 87;
const STILL_ACTIVE: u32 = 259;

struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe { CloseHandle(self.0) };
        }
    }
}

pub(crate) struct OwnedJob(HANDLE);

unsafe impl Send for OwnedJob {}
unsafe impl Sync for OwnedJob {}

impl Drop for OwnedJob {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CloseHandle(self.0) };
        }
    }
}

impl OwnedJob {
    pub(crate) fn terminate(&self) -> TerminationResult {
        if unsafe { TerminateJobObject(self.0, 1) } != 0 {
            TerminationResult::terminated(TerminationMethod::JobObject)
        } else {
            let error = std::io::Error::last_os_error();
            TerminationResult::failed(TerminationMethod::JobObject, error.to_string())
        }
    }
}

enum OpenedProcess {
    Found(OwnedHandle, String, bool),
    Missing,
    Unavailable(String),
}

pub(crate) fn identity(pid: u32) -> std::result::Result<String, String> {
    match open_process_with_identity(pid, PROCESS_QUERY_LIMITED_INFORMATION) {
        OpenedProcess::Found(_, identity, _) => Ok(identity),
        OpenedProcess::Missing => Err(format!("Process {pid} exited before identity collection")),
        OpenedProcess::Unavailable(error) => Err(error),
    }
}

pub(crate) fn inspect(target: &ManagedTarget) -> InspectionResult {
    match open_process_with_identity(target.pid, PROCESS_QUERY_LIMITED_INFORMATION) {
        OpenedProcess::Missing => InspectionResult::exited(),
        OpenedProcess::Unavailable(error) => InspectionResult::unknown(error),
        OpenedProcess::Found(_, _, false) => InspectionResult::exited(),
        OpenedProcess::Found(_, identity, true) if identity != target.identity => {
            InspectionResult::mismatch()
        }
        OpenedProcess::Found(_, _, true) => InspectionResult::alive(),
    }
}

pub(crate) fn terminate(target: &ManagedTarget, _signal: &str) -> TerminationResult {
    let root = match open_process_with_identity(
        target.pid,
        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
    ) {
        OpenedProcess::Missing => {
            return TerminationResult::not_attempted(TerminationMethod::None, None);
        }
        OpenedProcess::Unavailable(error) => {
            return TerminationResult::not_attempted(TerminationMethod::None, Some(error));
        }
        OpenedProcess::Found(_, _, false) => {
            return TerminationResult::not_attempted(TerminationMethod::None, None);
        }
        OpenedProcess::Found(handle, identity, true) if identity == target.identity => handle,
        OpenedProcess::Found(_, _, true) => {
            return TerminationResult::not_attempted(
                TerminationMethod::None,
                Some("PID was reused by another process".to_string()),
            );
        }
    };

    let descendants = match open_descendants(target.pid) {
        Ok(handles) => handles,
        Err(error) => {
            return TerminationResult::failed(TerminationMethod::ProcessTree, error);
        }
    };

    let mut failures = Vec::new();
    if unsafe { TerminateProcess(root.0, 1) } == 0 {
        failures.push(std::io::Error::last_os_error().to_string());
    }
    for process in descendants.into_iter().rev() {
        if unsafe { TerminateProcess(process.0, 1) } == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() != Some(ERROR_ACCESS_DENIED) {
                failures.push(error.to_string());
            }
        }
    }
    if failures.is_empty() {
        TerminationResult::terminated(TerminationMethod::ProcessTree)
    } else {
        TerminationResult::failed(TerminationMethod::ProcessTree, failures.join("; "))
    }
}

pub(crate) fn spawn_suspended_in_job(
    command: &mut Command,
) -> std::result::Result<(Child, OwnedJob), String> {
    let job = create_job()?;
    command.creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW);
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let process_handle = child.as_raw_handle() as HANDLE;

    if unsafe { AssignProcessToJobObject(job.0, process_handle) } == 0 {
        let error = std::io::Error::last_os_error();
        let _ = child.kill();
        return Err(format!("Failed to assign process to Windows Job: {error}"));
    }
    if let Err(error) = resume_process_thread(child.id()) {
        let _ = job.terminate();
        let _ = child.wait();
        return Err(error);
    }
    Ok((child, job))
}

fn open_process_with_identity(pid: u32, access: u32) -> OpenedProcess {
    let handle = unsafe { OpenProcess(access, 0, pid) };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        return if error.raw_os_error() == Some(ERROR_INVALID_PARAMETER) {
            OpenedProcess::Missing
        } else {
            OpenedProcess::Unavailable(error.to_string())
        };
    }
    let handle = OwnedHandle(handle);
    let identity = match creation_time(handle.0) {
        Ok(identity) => identity,
        Err(error) => return OpenedProcess::Unavailable(error),
    };
    let mut exit_code = 0;
    if unsafe { GetExitCodeProcess(handle.0, &mut exit_code) } == 0 {
        return OpenedProcess::Unavailable(std::io::Error::last_os_error().to_string());
    }
    OpenedProcess::Found(
        handle,
        format!("win32:{identity}"),
        exit_code == STILL_ACTIVE,
    )
}

fn creation_time(process: HANDLE) -> std::result::Result<String, String> {
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    if unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let ticks = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
    Ok(ticks.to_string())
}

fn open_descendants(root_pid: u32) -> std::result::Result<Vec<OwnedHandle>, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let snapshot = OwnedHandle(snapshot);
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut parents = HashMap::new();
    let mut has_entry = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    while has_entry {
        parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
        has_entry = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    let mut tree = HashSet::from([root_pid]);
    let mut changed = true;
    while changed {
        changed = false;
        for (&pid, &parent) in &parents {
            if tree.contains(&parent) && tree.insert(pid) {
                changed = true;
            }
        }
    }
    let mut handles = Vec::new();
    for pid in tree {
        if pid == root_pid {
            continue;
        }
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
        if !handle.is_null() {
            handles.push(OwnedHandle(handle));
        }
    }
    Ok(handles)
}

fn create_job() -> Result<OwnedJob, String> {
    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let job = OwnedJob(handle);
    let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let configured = unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if configured == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(job)
}

fn resume_process_thread(pid: u32) -> Result<(), String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let snapshot = OwnedHandle(snapshot);
    let mut entry = THREADENTRY32 {
        dwSize: size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    let mut has_entry = unsafe { Thread32First(snapshot.0, &mut entry) } != 0;
    while has_entry {
        if entry.th32OwnerProcessID == pid {
            let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
            if !thread.is_null() {
                let thread = OwnedHandle(thread);
                if unsafe { ResumeThread(thread.0) } != u32::MAX {
                    return Ok(());
                }
            }
        }
        has_entry = unsafe { Thread32Next(snapshot.0, &mut entry) } != 0;
    }
    Err(format!("Unable to resume suspended process {pid}"))
}
