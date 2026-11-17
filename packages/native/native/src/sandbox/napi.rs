use super::persistent::{self, Command, Event, RuntimeLimits, Shared};
use super::{
    Limits, MAX_CODE_BYTES, MAX_PRELUDE_BYTES, Message, Outcome, Script, contain_panic, run,
};
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
/// Persistent runtimes have their own cap, separate from one-shot scripts.
const MAX_ACTIVE_RUNTIMES: usize = 16;
static ACTIVE_RUNTIMES: AtomicUsize = AtomicUsize::new(0);

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
    pub uncounted_host_methods: Option<Vec<String>>,
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
        uncounted_host_methods: options.uncounted_host_methods.unwrap_or_default(),
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
            let outcome =
                contain_panic(|| run(script, limits, receiver, thread_cancelled, request));
            let _ = exit.call(Ok(outcome.into()), ThreadsafeFunctionCallMode::NonBlocking);
        })
        .map_err(|error| napi::Error::from_reason(format!("sandbox thread: {error}")))?;

    Ok(NativeSandboxScript {
        messages: sender,
        cancelled,
    })
}

#[napi(object)]
pub struct NativeSandboxRuntimeOptions {
    pub preludes: Vec<NativeSandboxPrelude>,
    pub memory_bytes: f64,
    pub time_ms_per_invocation: f64,
    pub host_calls_per_invocation: u32,
    pub uncounted_host_methods: Option<Vec<String>>,
    pub output_bytes: u32,
    pub stack_bytes: u32,
}

/// One tagged event from a persistent runtime; unused fields are absent.
#[napi(object)]
pub struct NativeSandboxRuntimeEvent {
    /// "ready" | "host_call" | "settled" | "closed"
    pub kind: String,
    pub invocation: Option<u32>,
    /// Host call id.
    pub id: Option<u32>,
    pub method: Option<String>,
    /// Host call JSON arguments.
    pub args: Option<String>,
    /// settled: "completed" | "failed" | "timed_out" | "cancelled" | "memory_limit" | "disposed".
    pub status: Option<String>,
    /// settled: result JSON or error message. ready/closed: error or reason, if any.
    pub value: Option<String>,
}

impl NativeSandboxRuntimeEvent {
    fn new(kind: &str) -> Self {
        Self {
            kind: kind.into(),
            invocation: None,
            id: None,
            method: None,
            args: None,
            status: None,
            value: None,
        }
    }
}

impl From<Event> for NativeSandboxRuntimeEvent {
    fn from(event: Event) -> Self {
        match event {
            Event::Ready(result) => Self {
                value: result.err(),
                ..Self::new("ready")
            },
            Event::HostCall {
                invocation,
                id,
                method,
                args,
            } => Self {
                invocation: Some(invocation),
                id: Some(id),
                method: Some(method),
                args: Some(args),
                ..Self::new("host_call")
            },
            Event::Settled {
                invocation,
                settlement,
            } => {
                let status = settlement.as_str().to_string();
                let value = match settlement {
                    persistent::Settlement::Value(json) => Some(json),
                    persistent::Settlement::Failed(message) => Some(message),
                    _ => None,
                };
                Self {
                    invocation: Some(invocation),
                    status: Some(status),
                    value,
                    ..Self::new("settled")
                }
            }
            Event::Closed(reason) => Self {
                value: reason,
                ..Self::new("closed")
            },
        }
    }
}

/// A persistent runtime. The thread owns the engine; this handle only sends commands.
#[napi]
pub struct NativeSandboxRuntime {
    commands: Sender<Command>,
    shared: Arc<Shared>,
}

#[napi]
impl NativeSandboxRuntime {
    /// Starts invocation `invocation` of the global function `name` with JSON `args`.
    #[napi]
    pub fn invoke(&self, invocation: u32, name: String, args: String) -> bool {
        self.commands
            .send(Command::Invoke {
                invocation,
                function: name,
                args,
            })
            .is_ok()
    }

    /// Settles host call `id`. `ok=false` rejects it with `value` as the message.
    #[napi]
    pub fn reply(&self, id: u32, ok: bool, value: String) -> bool {
        let result = if ok { Ok(value) } else { Err(value) };
        self.commands.send(Command::Reply { id, result }).is_ok()
    }

    /// Cancels one invocation, or all when `invocation` is absent.
    #[napi]
    pub fn cancel(&self, invocation: Option<u32>) {
        self.shared.cancel(invocation);
        let _ = self.commands.send(Command::Wake);
    }

    /// Ends the runtime and its thread; in-flight invocations settle as "disposed".
    #[napi]
    pub fn dispose(&self) {
        let _ = self.commands.send(Command::Dispose);
    }
}

#[napi]
pub fn open_sandbox_runtime(
    options: NativeSandboxRuntimeOptions,
    events: ThreadsafeFunction<NativeSandboxRuntimeEvent>,
) -> Result<NativeSandboxRuntime> {
    let prelude_bytes: usize = options.preludes.iter().map(|p| p.source.len()).sum();
    if prelude_bytes > MAX_PRELUDE_BYTES {
        return Err(napi::Error::from_reason("Preludes exceed the size limit"));
    }
    if !(options.time_ms_per_invocation.is_finite() && options.time_ms_per_invocation >= 1.0) {
        return Err(napi::Error::from_reason("Invalid timeMsPerInvocation"));
    }
    if !(options.memory_bytes.is_finite() && options.memory_bytes >= 1024.0 * 1024.0) {
        return Err(napi::Error::from_reason("Invalid memoryBytes"));
    }
    let limits = RuntimeLimits {
        memory_bytes: options.memory_bytes as usize,
        time_per_invocation: Duration::from_millis(options.time_ms_per_invocation as u64),
        host_calls_per_invocation: options.host_calls_per_invocation,
        uncounted_host_methods: options.uncounted_host_methods.unwrap_or_default(),
        max_result_bytes: options.output_bytes as usize,
        stack_bytes: options.stack_bytes as usize,
    };
    let preludes: Vec<(String, String)> = options
        .preludes
        .into_iter()
        .map(|p| (p.name, p.source))
        .collect();

    let permit = ActivePermit::acquire(&ACTIVE_RUNTIMES, MAX_ACTIVE_RUNTIMES)
        .ok_or_else(|| napi::Error::from_reason("Too many active sandbox runtimes"))?;
    let (sender, receiver) = channel();
    let shared = Arc::new(Shared::default());
    let thread_shared = shared.clone();
    std::thread::Builder::new()
        .name("nerve-sandbox-runtime".into())
        .stack_size(8 * 1024 * 1024)
        .spawn(move || {
            let _permit = permit;
            let sink = Box::new(move |event: Event| {
                let _ = events.call(Ok(event.into()), ThreadsafeFunctionCallMode::NonBlocking);
            });
            persistent::run(preludes, limits, receiver, thread_shared, sink);
        })
        .map_err(|error| napi::Error::from_reason(format!("sandbox thread: {error}")))?;

    Ok(NativeSandboxRuntime {
        commands: sender,
        shared,
    })
}
