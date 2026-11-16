//! Embedded QuickJS sandbox: one fresh runtime per script on a dedicated thread.
//!
//! The script sees only ECMAScript built-ins plus what the caller binds: `__print`
//! for output and `__hostCall` for async host requests. It has no filesystem,
//! network, timers or process access. The caller (TS) owns policy: which host
//! methods exist, permissions and approvals.

pub(crate) mod napi;

use rquickjs::{
    CaughtError, Context, Ctx, Function, Module, Persistent, Promise, Runtime, Value,
    allocator::{Allocator, RustAllocator},
    promise::PromiseState,
};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

pub(crate) const MAX_CODE_BYTES: usize = 1024 * 1024;
pub(crate) const MAX_PRELUDE_BYTES: usize = 8 * 1024 * 1024;
const MAX_STACK_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct Limits {
    pub memory_bytes: usize,
    pub timeout: Duration,
    pub max_host_calls: u32,
    /// Host methods that never count toward `max_host_calls` (e.g. timers, bounded by the timeout).
    pub uncounted_host_methods: Vec<String>,
    pub max_output_bytes: usize,
}

pub(crate) struct Script {
    /// Trusted helper scripts evaluated as classic scripts before the module.
    pub preludes: Vec<(String, String)>,
    pub name: String,
    /// The agent's code, evaluated as an ES module (top-level await allowed).
    pub code: String,
}

pub(crate) enum Message {
    Reply {
        id: u32,
        result: Result<String, String>,
    },
    Cancel,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Status {
    Completed,
    Failed,
    TimedOut,
    Cancelled,
    MemoryLimit,
}

impl Status {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::TimedOut => "timed_out",
            Self::Cancelled => "cancelled",
            Self::MemoryLimit => "memory_limit",
        }
    }
}

#[derive(Debug)]
pub(crate) struct Outcome {
    pub status: Status,
    pub error: Option<String>,
    pub output: String,
    pub output_truncated: bool,
    pub host_calls: u32,
    pub duration: Duration,
    pub memory_used_bytes: i64,
}

/// Host request sink. Called on the sandbox thread; must not block.
pub(crate) type HostRequest = Box<dyn Fn(u32, String, String) + Send>;

const STOP_NONE: u8 = 0;
const STOP_TIMEOUT: u8 = 1;
const STOP_CANCEL: u8 = 2;

#[derive(Default)]
struct Output {
    text: String,
    truncated: bool,
}

struct State {
    pending: HashMap<u32, (Persistent<Function<'static>>, Persistent<Function<'static>>)>,
    next_id: u32,
    calls: u32,
    output: Output,
}

/// Runs `f` and maps a panic to a failed outcome, so the caller always gets an exit.
pub(crate) fn contain_panic(f: impl FnOnce() -> Outcome) -> Outcome {
    let started = Instant::now();
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|payload| {
        let detail = payload
            .downcast_ref::<&str>()
            .map(|text| (*text).to_string())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".into());
        Outcome {
            status: Status::Failed,
            error: Some(format!("sandbox thread panicked: {detail}")),
            output: String::new(),
            output_truncated: false,
            host_calls: 0,
            duration: started.elapsed(),
            memory_used_bytes: 0,
        }
    })
}

pub(crate) fn run(
    script: Script,
    limits: Limits,
    messages: Receiver<Message>,
    cancelled: Arc<AtomicBool>,
    host: HostRequest,
) -> Outcome {
    let started = Instant::now();
    let deadline = started + limits.timeout;
    let stop = Arc::new(AtomicU8::new(STOP_NONE));
    let fail = |status, error: String| Outcome {
        status,
        error: Some(error),
        output: String::new(),
        output_truncated: false,
        host_calls: 0,
        duration: started.elapsed(),
        memory_used_bytes: 0,
    };

    let memory_exhausted = Arc::new(AtomicBool::new(false));
    let allocator = LimitedAllocator {
        limit: limits.memory_bytes,
        used: 0,
        exhausted: memory_exhausted.clone(),
    };
    let runtime = match Runtime::new_with_alloc(allocator) {
        Ok(runtime) => runtime,
        Err(error) => return fail(Status::Failed, format!("sandbox runtime: {error}")),
    };
    runtime.set_max_stack_size(MAX_STACK_BYTES);
    {
        let stop = stop.clone();
        let cancelled = cancelled.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || {
            if cancelled.load(Ordering::Acquire) {
                stop.store(STOP_CANCEL, Ordering::Release);
                true
            } else if Instant::now() >= deadline {
                stop.store(STOP_TIMEOUT, Ordering::Release);
                true
            } else {
                false
            }
        })));
    }
    let context = match Context::full(&runtime) {
        Ok(context) => context,
        Err(error) => return fail(Status::Failed, format!("sandbox context: {error}")),
    };

    let state = Rc::new(RefCell::new(State {
        pending: HashMap::new(),
        next_id: 1,
        calls: 0,
        output: Output::default(),
    }));
    let host = Rc::new(host);

    let module = context.with(|ctx| -> Result<Persistent<Promise<'static>>, String> {
        install_globals(&ctx, &state, &host, &limits).map_err(|e| describe(&ctx, e))?;
        for (name, source) in &script.preludes {
            ctx.eval_with_options::<(), _>(source.as_str(), {
                let mut options = rquickjs::context::EvalOptions::default();
                options.global = true;
                options.strict = false;
                options.filename = Some(name.clone());
                options
            })
            .map_err(|e| describe(&ctx, e))?;
        }
        let promise = Module::evaluate(ctx.clone(), script.name.as_str(), script.code.as_str())
            .map_err(|e| describe(&ctx, e))?;
        Ok(Persistent::save(&ctx, promise))
    });

    let mut result: Result<(), String> = Ok(());
    let mut status = Status::Completed;
    match module {
        Err(error) => {
            status = Status::Failed;
            result = Err(error);
        }
        Ok(module) => loop {
            // Drive microtasks until the queue is empty.
            loop {
                match runtime.execute_pending_job() {
                    Ok(true) => continue,
                    Ok(false) => break,
                    Err(job) => {
                        let message = job.0.with(|ctx| describe_value(&ctx, ctx.catch()));
                        result = Err(message);
                        break;
                    }
                }
            }
            if result.is_err() {
                status = Status::Failed;
                break;
            }
            let settled = context.with(|ctx| -> Option<Result<(), String>> {
                let promise = module.clone().restore(&ctx).ok()?;
                match promise.state() {
                    PromiseState::Pending => None,
                    PromiseState::Resolved => Some(Ok(())),
                    PromiseState::Rejected => {
                        let _ = promise.result::<Value>();
                        Some(Err(describe_value(&ctx, ctx.catch())))
                    }
                }
            });
            if let Some(settled) = settled {
                if let Err(error) = settled {
                    status = Status::Failed;
                    result = Err(error);
                }
                break;
            }
            if state.borrow().pending.is_empty() {
                status = Status::Failed;
                result = Err("script is waiting on a promise that can never settle".into());
                break;
            }
            let now = Instant::now();
            if now >= deadline {
                stop.store(STOP_TIMEOUT, Ordering::Release);
                break;
            }
            match messages.recv_timeout(deadline - now) {
                Ok(Message::Cancel) | Err(RecvTimeoutError::Disconnected) => {
                    stop.store(STOP_CANCEL, Ordering::Release);
                    break;
                }
                Err(RecvTimeoutError::Timeout) => {
                    stop.store(STOP_TIMEOUT, Ordering::Release);
                    break;
                }
                Ok(Message::Reply { id, result: reply }) => {
                    let entry = state.borrow_mut().pending.remove(&id);
                    if let Some((resolve, reject)) = entry {
                        context.with(|ctx| {
                            let call = match reply {
                                Ok(json) => {
                                    resolve.restore(&ctx).and_then(|f| f.call::<_, ()>((json,)))
                                }
                                Err(message) => reject
                                    .restore(&ctx)
                                    .and_then(|f| f.call::<_, ()>((message,))),
                            };
                            if let Err(error) = call {
                                let _ = describe(&ctx, error);
                            }
                        });
                    }
                }
            }
        },
    }

    match stop.load(Ordering::Acquire) {
        STOP_TIMEOUT => {
            status = Status::TimedOut;
            result = Err(format!("script exceeded {} ms", limits.timeout.as_millis()));
        }
        STOP_CANCEL => {
            status = Status::Cancelled;
            result = Err("script cancelled".into());
        }
        _ => {}
    }

    let memory_used_bytes = runtime.memory_usage().memory_used_size;
    // QuickJS reports OOM as "out of memory" or, when it cannot allocate the error
    // object, as a bare `null` exception; the allocator records the refusal either way.
    if status == Status::Failed && memory_exhausted.load(Ordering::Acquire) {
        status = Status::MemoryLimit;
        result = Err(format!(
            "script exceeded the {} MiB memory limit",
            limits.memory_bytes / (1024 * 1024)
        ));
    }
    // Persistent handles must be released while the runtime is alive.
    let (output, host_calls) = {
        let mut state = state.borrow_mut();
        state.pending.clear();
        (std::mem::take(&mut state.output), state.calls)
    };
    drop(context);
    drop(runtime);

    Outcome {
        status,
        error: result.err(),
        output: output.text,
        output_truncated: output.truncated,
        host_calls,
        duration: started.elapsed(),
        memory_used_bytes,
    }
}

fn install_globals<'js>(
    ctx: &Ctx<'js>,
    state: &Rc<RefCell<State>>,
    host: &Rc<HostRequest>,
    limits: &Limits,
) -> rquickjs::Result<()> {
    let globals = ctx.globals();
    let max_output = limits.max_output_bytes;
    let print_state = state.clone();
    globals.set(
        "__print",
        Function::new(ctx.clone(), move |line: String| {
            let mut state = print_state.borrow_mut();
            let output = &mut state.output;
            if output.truncated {
                return;
            }
            let needed = line.len() + 1;
            if output.text.len() + needed > max_output {
                output.truncated = true;
                return;
            }
            output.text.push_str(&line);
            output.text.push('\n');
        })?,
    )?;

    let max_calls = limits.max_host_calls;
    let uncounted = limits.uncounted_host_methods.clone();
    let call_state = state.clone();
    let call_host = host.clone();
    globals.set(
        "__hostCall",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>, method: String, args: String| -> rquickjs::Result<Promise<'js>> {
                let id = {
                    let mut state = call_state.borrow_mut();
                    if !uncounted.contains(&method) {
                        if state.calls >= max_calls {
                            return Err(rquickjs::Exception::throw_range(
                                &ctx,
                                &format!("host call limit of {max_calls} reached"),
                            ));
                        }
                        state.calls += 1;
                    }
                    let id = state.next_id;
                    state.next_id += 1;
                    id
                };
                let (promise, resolve, reject) = Promise::new(&ctx)?;
                call_state.borrow_mut().pending.insert(
                    id,
                    (
                        Persistent::save(&ctx, resolve),
                        Persistent::save(&ctx, reject),
                    ),
                );
                (call_host)(id, method, args);
                Ok(promise)
            },
        )?,
    )?;
    Ok(())
}

/// Enforces the memory limit at the allocator and records when it refuses, so an
/// out-of-memory failure is detected exactly instead of inferred from usage.
struct LimitedAllocator {
    limit: usize,
    used: usize,
    exhausted: Arc<AtomicBool>,
}

impl LimitedAllocator {
    fn admit(&self, released: usize, requested: usize) -> bool {
        let fits = self
            .used
            .saturating_sub(released)
            .checked_add(requested)
            .is_some_and(|total| total <= self.limit);
        if !fits {
            self.exhausted.store(true, Ordering::Release);
        }
        fits
    }
}

// SAFETY: every call delegates to `RustAllocator`; this wrapper only refuses requests
// (returning null, which QuickJS handles as OOM) and tracks usable sizes.
unsafe impl Allocator for LimitedAllocator {
    fn alloc(&mut self, size: usize) -> *mut u8 {
        if !self.admit(0, size) {
            return std::ptr::null_mut();
        }
        let ptr = RustAllocator.alloc(size);
        if !ptr.is_null() {
            self.used += unsafe { RustAllocator::usable_size(ptr) };
        }
        ptr
    }

    fn calloc(&mut self, count: usize, size: usize) -> *mut u8 {
        let Some(total) = count.checked_mul(size) else {
            return std::ptr::null_mut();
        };
        if !self.admit(0, total) {
            return std::ptr::null_mut();
        }
        let ptr = RustAllocator.calloc(count, size);
        if !ptr.is_null() {
            self.used += unsafe { RustAllocator::usable_size(ptr) };
        }
        ptr
    }

    unsafe fn dealloc(&mut self, ptr: *mut u8) {
        self.used = self
            .used
            .saturating_sub(unsafe { RustAllocator::usable_size(ptr) });
        unsafe { RustAllocator.dealloc(ptr) }
    }

    unsafe fn realloc(&mut self, ptr: *mut u8, new_size: usize) -> *mut u8 {
        let old_size = unsafe { RustAllocator::usable_size(ptr) };
        if !self.admit(old_size, new_size) {
            return std::ptr::null_mut();
        }
        let next = unsafe { RustAllocator.realloc(ptr, new_size) };
        if !next.is_null() {
            self.used = self.used - old_size + unsafe { RustAllocator::usable_size(next) };
        }
        next
    }

    unsafe fn usable_size(ptr: *mut u8) -> usize {
        unsafe { RustAllocator::usable_size(ptr) }
    }
}

fn describe(ctx: &Ctx<'_>, error: rquickjs::Error) -> String {
    CaughtError::from_error(ctx, error).to_string()
}

fn describe_value<'js>(ctx: &Ctx<'js>, value: Value<'js>) -> String {
    if let Some(exception) = value
        .as_object()
        .and_then(|object| rquickjs::Exception::from_object(object.clone()))
    {
        let message = exception.message().unwrap_or_default();
        let name: String = exception
            .get::<_, String>("name")
            .unwrap_or_else(|_| "Error".into());
        return match exception.stack() {
            Some(stack) if !stack.is_empty() => format!("{name}: {message}\n{}", stack.trim_end()),
            _ => format!("{name}: {message}"),
        };
    }
    if let Some(string) = value.as_string() {
        return string.to_string().unwrap_or_default();
    }
    let _ = ctx;
    format!("{value:?}")
}

#[cfg(test)]
mod tests;
