mod cgroup;

pub(crate) use cgroup::{CgroupGuard, prepare as prepare_cgroup};

use std::fs;
use std::io::ErrorKind;

use crate::process::{InspectionResult, ManagedTarget, TerminationMethod, TerminationResult};

struct ProcessIdentity {
    state: char,
    process_group_id: u32,
    start_time_ticks: String,
}

enum ReadIdentity {
    Found(ProcessIdentity),
    Missing,
    Unavailable(String),
}

pub(crate) fn identity(pid: u32) -> Result<String, String> {
    match read_identity(pid) {
        ReadIdentity::Found(value) => Ok(format!("linux:{}", value.start_time_ticks)),
        ReadIdentity::Missing => Err(format!("Process {pid} exited before identity collection")),
        ReadIdentity::Unavailable(error) => Err(error),
    }
}

pub(crate) fn inspect(target: &ManagedTarget) -> InspectionResult {
    match read_identity(target.pid) {
        ReadIdentity::Missing => InspectionResult::exited(),
        ReadIdentity::Unavailable(error) => InspectionResult::unknown(error),
        ReadIdentity::Found(value) if value.state == 'Z' => InspectionResult::exited(),
        ReadIdentity::Found(value) => {
            if format!("linux:{}", value.start_time_ticks) == target.identity {
                InspectionResult::alive()
            } else {
                InspectionResult::mismatch()
            }
        }
    }
}

pub(crate) fn terminate(target: &ManagedTarget, signal: &str) -> TerminationResult {
    match read_identity(target.pid) {
        ReadIdentity::Missing => {
            return TerminationResult::not_attempted(TerminationMethod::None, None);
        }
        ReadIdentity::Unavailable(error) => {
            return TerminationResult::not_attempted(TerminationMethod::None, Some(error));
        }
        ReadIdentity::Found(value) if value.state == 'Z' => {
            return TerminationResult::not_attempted(TerminationMethod::None, None);
        }
        ReadIdentity::Found(value) => {
            if format!("linux:{}", value.start_time_ticks) != target.identity {
                return TerminationResult::not_attempted(
                    TerminationMethod::None,
                    Some("PID was reused by another process".to_string()),
                );
            }
            if let Some(expected_group) = target.process_group_id
                && value.process_group_id != expected_group
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

fn read_identity(pid: u32) -> ReadIdentity {
    let stat = match fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => stat,
        Err(error) if error.kind() == ErrorKind::NotFound => return ReadIdentity::Missing,
        Err(error) => return ReadIdentity::Unavailable(error.to_string()),
    };
    match parse_stat(&stat) {
        Some(identity) => ReadIdentity::Found(identity),
        None => ReadIdentity::Unavailable(format!("Malformed /proc/{pid}/stat")),
    }
}

fn parse_stat(stat: &str) -> Option<ProcessIdentity> {
    let close = stat.rfind(')')?;
    let fields: Vec<&str> = stat[close + 1..].split_whitespace().collect();
    Some(ProcessIdentity {
        state: fields.first()?.chars().next()?,
        process_group_id: fields.get(2)?.parse().ok()?,
        start_time_ticks: fields.get(19)?.to_string(),
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_comm_with_spaces_and_parentheses() {
        let mut fields = vec!["S", "1", "42"];
        fields.extend(std::iter::repeat_n("0", 16));
        fields.push("98765");
        let stat = format!("123 (a tricky) name) {}", fields.join(" "));
        let parsed = super::parse_stat(&stat).expect("stat should parse");
        assert_eq!(parsed.state, 'S');
        assert_eq!(parsed.process_group_id, 42);
        assert_eq!(parsed.start_time_ticks, "98765");
    }
}
