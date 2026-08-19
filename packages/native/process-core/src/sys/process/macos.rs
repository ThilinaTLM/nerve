use std::ffi::{c_int, c_void};
use std::mem::size_of;

use crate::process::{InspectionResult, ManagedTarget, TerminationMethod, TerminationResult};

const PROC_PIDTBSDINFO: c_int = 3;
const PROCESS_STATUS_ZOMBIE: u32 = 5;

#[repr(C)]
#[derive(Clone, Copy)]
struct ProcBsdInfo {
    pbi_flags: u32,
    pbi_status: u32,
    pbi_xstatus: u32,
    pbi_pid: u32,
    pbi_ppid: u32,
    pbi_uid: u32,
    pbi_gid: u32,
    pbi_ruid: u32,
    pbi_rgid: u32,
    pbi_svuid: u32,
    pbi_svgid: u32,
    rfu_1: u32,
    pbi_comm: [u8; 16],
    pbi_name: [u8; 32],
    pbi_nfiles: u32,
    pbi_pgid: u32,
    pbi_pjobc: u32,
    e_tdev: u32,
    e_tpgid: u32,
    pbi_nice: i32,
    pbi_start_tvsec: u64,
    pbi_start_tvusec: u64,
}

unsafe extern "C" {
    fn proc_pidinfo(
        pid: c_int,
        flavor: c_int,
        arg: u64,
        buffer: *mut c_void,
        buffersize: c_int,
    ) -> c_int;
}

enum ReadIdentity {
    Found(ProcBsdInfo),
    Missing,
    Unavailable(String),
}

pub fn identity(pid: u32) -> Result<String, String> {
    match read_identity(pid) {
        ReadIdentity::Found(value) => Ok(identity_value(&value)),
        ReadIdentity::Missing => Err(format!("Process {pid} exited before identity collection")),
        ReadIdentity::Unavailable(error) => Err(error),
    }
}

pub fn inspect(target: &ManagedTarget) -> InspectionResult {
    match read_identity(target.pid) {
        ReadIdentity::Missing => InspectionResult::exited(),
        ReadIdentity::Unavailable(error) => InspectionResult::unknown(error),
        ReadIdentity::Found(value) if value.pbi_status == PROCESS_STATUS_ZOMBIE => {
            InspectionResult::exited()
        }
        ReadIdentity::Found(value) if identity_value(&value) != target.identity => {
            InspectionResult::mismatch()
        }
        ReadIdentity::Found(_) => InspectionResult::alive(),
    }
}

pub fn terminate(target: &ManagedTarget, signal: &str) -> TerminationResult {
    match read_identity(target.pid) {
        ReadIdentity::Missing => {
            return TerminationResult::not_attempted(TerminationMethod::None, None);
        }
        ReadIdentity::Unavailable(error) => {
            return TerminationResult::not_attempted(TerminationMethod::None, Some(error));
        }
        ReadIdentity::Found(value) => {
            if value.pbi_status == PROCESS_STATUS_ZOMBIE {
                return TerminationResult::not_attempted(TerminationMethod::None, None);
            }
            if identity_value(&value) != target.identity {
                return TerminationResult::not_attempted(
                    TerminationMethod::None,
                    Some("PID was reused by another process".to_string()),
                );
            }
            if let Some(expected_group) = target.process_group_id
                && value.pbi_pgid != expected_group
            {
                return TerminationResult::not_attempted(
                    TerminationMethod::None,
                    Some("Process group no longer matches the managed target".to_string()),
                );
            }
        }
    }
    super::signal_target(target, signal)
}

fn identity_value(value: &ProcBsdInfo) -> String {
    format!(
        "darwin:{}:{}",
        value.pbi_start_tvsec, value.pbi_start_tvusec
    )
}

fn read_identity(pid: u32) -> ReadIdentity {
    let mut info = unsafe { std::mem::zeroed::<ProcBsdInfo>() };
    let result = unsafe {
        proc_pidinfo(
            pid as c_int,
            PROC_PIDTBSDINFO,
            0,
            &mut info as *mut _ as *mut c_void,
            size_of::<ProcBsdInfo>() as c_int,
        )
    };
    if result == size_of::<ProcBsdInfo>() as c_int {
        return ReadIdentity::Found(info);
    }
    let error = std::io::Error::last_os_error();
    match error.raw_os_error() {
        Some(libc::ESRCH) | Some(libc::ENOENT) => ReadIdentity::Missing,
        _ => ReadIdentity::Unavailable(error.to_string()),
    }
}
