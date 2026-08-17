use std::ffi::c_void;
use std::mem::size_of;
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};

use napi::bindgen_prelude::Result;
use windows_sys::Win32::Foundation::{CloseHandle, FILETIME, HANDLE, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, GetProcessTimes, OpenProcess, OpenThread,
    PROCESS_QUERY_LIMITED_INFORMATION, ResumeThread, THREAD_SUSPEND_RESUME,
};

pub struct OwnedJob(HANDLE);

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
    pub fn terminate(&self) -> Result<bool> {
        if unsafe { TerminateJobObject(self.0, 1) } != 0 {
            Ok(true)
        } else {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(5) {
                Ok(false)
            } else {
                Err(napi::Error::from_reason(error.to_string()))
            }
        }
    }
}

pub fn spawn_suspended_in_job(command: &mut Command) -> Result<(Child, OwnedJob)> {
    let job = create_job()?;
    command.creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;
    let process_handle = child.as_raw_handle() as HANDLE;

    if unsafe { AssignProcessToJobObject(job.0, process_handle) } == 0 {
        let error = std::io::Error::last_os_error();
        let _ = child.kill();
        return Err(napi::Error::from_reason(format!(
            "Failed to assign process to Windows Job: {error}"
        )));
    }

    if let Err(error) = resume_process_thread(child.id()) {
        let _ = job.terminate();
        let _ = child.wait();
        return Err(error);
    }
    Ok((child, job))
}

fn create_job() -> Result<OwnedJob> {
    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(napi::Error::from_reason(
            std::io::Error::last_os_error().to_string(),
        ));
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
        return Err(napi::Error::from_reason(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    Ok(job)
}

fn resume_process_thread(pid: u32) -> Result<()> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(napi::Error::from_reason(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    let mut entry = THREADENTRY32 {
        dwSize: size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    let mut found = false;
    let mut has_entry = unsafe { Thread32First(snapshot, &mut entry) } != 0;
    while has_entry {
        if entry.th32OwnerProcessID == pid {
            let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID) };
            if !thread.is_null() {
                let resumed = unsafe { ResumeThread(thread) };
                unsafe { CloseHandle(thread) };
                if resumed != u32::MAX {
                    found = true;
                    break;
                }
            }
        }
        has_entry = unsafe { Thread32Next(snapshot, &mut entry) } != 0;
    }
    unsafe { CloseHandle(snapshot) };
    if found {
        Ok(())
    } else {
        Err(napi::Error::from_reason(format!(
            "Unable to resume suspended process {pid}"
        )))
    }
}

pub fn process_creation_time(pid: u32) -> Result<String> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if process.is_null() {
        return Err(napi::Error::from_reason(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    let success =
        unsafe { GetProcessTimes(process, &mut creation, &mut exit, &mut kernel, &mut user) };
    unsafe { CloseHandle(process) };
    if success == 0 {
        return Err(napi::Error::from_reason(
            std::io::Error::last_os_error().to_string(),
        ));
    }
    let ticks = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
    Ok(ticks.to_string())
}
