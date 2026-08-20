const DEFAULT_QUEUE_BYTES: u64 = 1024 * 1024;
const DEFAULT_BATCH_BYTES: u64 = 256 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum EnforcementMode {
    Required,
    BestEffort,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OutputOverflow {
    Truncate,
    Terminate,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct RequestedPolicy {
    pub(crate) enforcement: Option<String>,
    pub(crate) memory_bytes: Option<f64>,
    pub(crate) max_cpu_cores: Option<f64>,
    pub(crate) max_processes: Option<f64>,
    pub(crate) wall_time_ms: Option<f64>,
    pub(crate) output: Option<RequestedOutputPolicy>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct RequestedOutputPolicy {
    pub(crate) queue_bytes: Option<f64>,
    pub(crate) batch_bytes: Option<f64>,
    pub(crate) total_bytes: Option<f64>,
    pub(crate) overflow: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct ResourcePolicy {
    pub(crate) enforcement: EnforcementMode,
    pub(crate) memory_bytes: Option<u64>,
    pub(crate) max_cpu_cores: Option<f64>,
    pub(crate) max_processes: Option<u32>,
    pub(crate) wall_time_ms: Option<u64>,
    pub(crate) output: OutputPolicy,
}

#[derive(Clone, Debug)]
pub(crate) struct OutputPolicy {
    pub(crate) queue_bytes: usize,
    pub(crate) batch_bytes: usize,
    pub(crate) total_bytes: Option<u64>,
    pub(crate) overflow: Option<OutputOverflow>,
}

impl ResourcePolicy {
    pub(crate) fn normalize(requested: RequestedPolicy) -> Result<Self, String> {
        let enforcement = match requested.enforcement.as_deref().unwrap_or("best-effort") {
            "required" => EnforcementMode::Required,
            "best-effort" => EnforcementMode::BestEffort,
            value => return Err(format!("Unknown managed-process enforcement mode: {value}")),
        };
        let output = requested.output.unwrap_or_default();
        let queue_bytes = positive_integer(
            "policy.output.queueBytes",
            output.queue_bytes.unwrap_or(DEFAULT_QUEUE_BYTES as f64),
        )?;
        let batch_bytes = positive_integer(
            "policy.output.batchBytes",
            output.batch_bytes.unwrap_or(DEFAULT_BATCH_BYTES as f64),
        )?;
        if batch_bytes > queue_bytes {
            return Err("policy.output.batchBytes must not exceed queueBytes".to_string());
        }
        let total_bytes =
            optional_positive_integer("policy.output.totalBytes", output.total_bytes)?;
        let overflow = match output.overflow.as_deref() {
            Some("truncate") => Some(OutputOverflow::Truncate),
            Some("terminate") => Some(OutputOverflow::Terminate),
            Some(value) => {
                return Err(format!(
                    "Unknown managed-process output overflow mode: {value}"
                ));
            }
            None => None,
        };
        if total_bytes.is_some() && overflow.is_none() {
            return Err("policy.output.overflow is required when totalBytes is set".to_string());
        }
        if total_bytes.is_none() && overflow.is_some() {
            return Err("policy.output.totalBytes is required when overflow is set".to_string());
        }
        let max_cpu_cores = match requested.max_cpu_cores {
            Some(value) if value.is_finite() && value > 0.0 => Some(value),
            Some(_) => {
                return Err("policy.maxCpuCores must be a finite positive number".to_string());
            }
            None => None,
        };
        Ok(Self {
            enforcement,
            memory_bytes: optional_positive_integer("policy.memoryBytes", requested.memory_bytes)?,
            max_cpu_cores,
            max_processes: optional_positive_integer(
                "policy.maxProcesses",
                requested.max_processes,
            )?
            .map(|value| {
                u32::try_from(value).map_err(|_| "policy.maxProcesses exceeds u32".to_string())
            })
            .transpose()?,
            wall_time_ms: optional_positive_integer("policy.wallTimeMs", requested.wall_time_ms)?,
            output: OutputPolicy {
                queue_bytes: usize::try_from(queue_bytes)
                    .map_err(|_| "policy.output.queueBytes exceeds platform size".to_string())?,
                batch_bytes: usize::try_from(batch_bytes)
                    .map_err(|_| "policy.output.batchBytes exceeds platform size".to_string())?,
                total_bytes,
                overflow,
            },
        })
    }
}

fn optional_positive_integer(name: &str, value: Option<f64>) -> Result<Option<u64>, String> {
    value.map(|value| positive_integer(name, value)).transpose()
}

fn positive_integer(name: &str, value: f64) -> Result<u64, String> {
    if !value.is_finite() || value <= 0.0 || value.fract() != 0.0 || value > 9_007_199_254_740_991.0
    {
        return Err(format!("{name} must be a positive safe integer"));
    }
    Ok(value as u64)
}

#[cfg(test)]
mod tests {
    use super::{OutputOverflow, RequestedOutputPolicy, RequestedPolicy, ResourcePolicy};

    #[test]
    fn normalizes_output_defaults_and_limits() {
        let policy = ResourcePolicy::normalize(RequestedPolicy {
            output: Some(RequestedOutputPolicy {
                total_bytes: Some(2048.0),
                overflow: Some("terminate".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        })
        .expect("policy should normalize");
        assert_eq!(policy.output.queue_bytes, 1024 * 1024);
        assert_eq!(policy.output.batch_bytes, 256 * 1024);
        assert_eq!(policy.output.total_bytes, Some(2048));
        assert_eq!(policy.output.overflow, Some(OutputOverflow::Terminate));
    }

    #[test]
    fn rejects_unsafe_or_incomplete_limits() {
        assert!(
            ResourcePolicy::normalize(RequestedPolicy {
                memory_bytes: Some(f64::NAN),
                ..Default::default()
            })
            .is_err()
        );
        assert!(
            ResourcePolicy::normalize(RequestedPolicy {
                output: Some(RequestedOutputPolicy {
                    total_bytes: Some(10.0),
                    ..Default::default()
                }),
                ..Default::default()
            })
            .is_err()
        );
    }
}
