use super::{Limits, MAX_CODE_BYTES, MAX_PRELUDE_BYTES, Message, Outcome, Script, run};
use crate::core::admission::ActivePermit;
use napi::bindgen_prelude::Result;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{Sender, channel};
use std::time::Duration;

const MAX_ACTIVE_SCRIPTS: usize = 4;
static ACTIVE_SCRIPTS: AtomicUsize = AtomicUsize::new(0);

#[napi(object)]
pub struct NativeSandboxPrelude {
    pub name: String,
    pub source: String,
}

#[napi(object)]
pub struct NativeSandboxOptions {
    pub name: String,
    pub code: String,
    pub preludes: Vec<NativeSandboxPrelude>,
    pub memory_bytes: f64,
    pub timeout_ms: f64,
    pub max_host_calls: u32,
    pub max_output_bytes: u32,
}

#[napi(object)]
pub struct NativeSandboxHostCall {
    pub id: u32,
    pub method: String,
    /// JSON-encoded arguments.
    pub args: String,
}

#[napi(object)]
pub struct NativeSandboxOutcome {
    /// "completed" | "failed" | "timed_out" | "cancelled" | "memory_limit"
    pub status: String,
    pub error: Option<String>,
    pub output: String,
    pub output_truncated: bool,
    pub host_calls: u32,
    pub duration_ms: f64,
    pub memory_used_bytes: f64,
}

impl From<Outcome> for NativeSandboxOutcome {
    fn from(value: Outcome) -> Self {
        Self {
            status: value.status.as_str().into(),
            error: value.error,
            output: value.output,
            output_truncated: value.output_truncated,
            host_calls: value.host_calls,
            duration_ms: value.duration.as_secs_f64() * 1000.0,
            memory_used_bytes: value.memory_used_bytes as f64,
        }
    }
}

/// A running script. Host replies and cancellation are delivered by message; the
/// engine thread owns the runtime.
#[napi]
pub struct NativeSandboxScript {
    messages: Sender<Message>,
    cancelled: Arc<AtomicBool>,
}

#[napi]
impl NativeSandboxScript {
    /// Settles host call `id`. `ok=false` rejects it with `value` as the message.
    /// Returns false when the script is no longer waiting for it.
    #[napi]
    pub fn reply(&self, id: u32, ok: bool, value: String) -> bool {
        let result = if ok { Ok(value) } else { Err(value) };
        self.messages.send(Message::Reply { id, result }).is_ok()
    }

    #[napi]
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        let _ = self.messages.send(Message::Cancel);
    }
}

#[napi]
pub fn start_sandbox_script(
    options: NativeSandboxOptions,
    host_call: ThreadsafeFunction<NativeSandboxHostCall>,
    exit: ThreadsafeFunction<NativeSandboxOutcome>,
) -> Result<NativeSandboxScript> {
    if options.code.len() > MAX_CODE_BYTES {
        return Err(napi::Error::from_reason(
            "Script exceeds the code size limit",
        ));
    }
    let prelude_bytes: usize = options.preludes.iter().map(|p| p.source.len()).sum();
    if prelude_bytes > MAX_PRELUDE_BYTES {
        return Err(napi::Error::from_reason("Preludes exceed the size limit"));
    }
    if !(options.timeout_ms.is_finite() && options.timeout_ms >= 1.0) {
        return Err(napi::Error::from_reason("Invalid timeoutMs"));
    }
    if !(options.memory_bytes.is_finite() && options.memory_bytes >= 1024.0 * 1024.0) {
        return Err(napi::Error::from_reason("Invalid memoryBytes"));
    }
    let limits = Limits {
        memory_bytes: options.memory_bytes as usize,
        timeout: Duration::from_millis(options.timeout_ms as u64),
        max_host_calls: options.max_host_calls,
        max_output_bytes: options.max_output_bytes as usize,
    };
    let script = Script {
        preludes: options
            .preludes
            .into_iter()
            .map(|p| (p.name, p.source))
            .collect(),
        name: options.name,
        code: options.code,
    };

    let permit = ActivePermit::acquire(&ACTIVE_SCRIPTS, MAX_ACTIVE_SCRIPTS)
        .ok_or_else(|| napi::Error::from_reason("Too many active sandbox scripts"))?;
    let (sender, receiver) = channel();
    let cancelled = Arc::new(AtomicBool::new(false));
    let thread_cancelled = cancelled.clone();
    std::thread::Builder::new()
        .name("nerve-sandbox".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(move || {
            let _permit = permit;
            let request = Box::new(move |id, method, args| {
                let _ = host_call.call(
                    Ok(NativeSandboxHostCall { id, method, args }),
                    ThreadsafeFunctionCallMode::NonBlocking,
                );
            });
            let outcome = run(script, limits, receiver, thread_cancelled, request);
            let _ = exit.call(Ok(outcome.into()), ThreadsafeFunctionCallMode::NonBlocking);
        })
        .map_err(|error| napi::Error::from_reason(format!("sandbox thread: {error}")))?;

    Ok(NativeSandboxScript {
        messages: sender,
        cancelled,
    })
}
