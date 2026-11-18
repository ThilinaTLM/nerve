//! Long-lived sandbox runtime: one QuickJS runtime on its own thread that evaluates
//! its preludes once and then serves any number of `invoke` calls until disposed.
//!
//! Differences from the one-shot `run`:
//! - An idle runtime (no invocation, no host call) is normal; the thread blocks on commands.
//! - The time limit and host-call budget are **per invocation**; the deadline is armed
//!   when the invocation starts, so idle gaps never count.
//! - Invocations interleave on the thread's job queue. A JS async context does not exist
//!   in QuickJS, so JS passes its invocation id to `__hostCall(method, args, invocation)`.
//!   When it is omitted, the call belongs to the only active invocation (or fails).
//! - The memory limit covers the runtime's lifetime. Once the allocator refuses a request
//!   the runtime is closed: in-flight invocations fail and the thread exits.
//! - Preludes may only define globals; `invoke` calls one by name as `fn(args, invocation)`.

use super::{LimitedAllocator, describe, describe_value};
use rquickjs::{Context, Ctx, Function, Persistent, Promise, Runtime, function::Opt};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Debug)]
pub(crate) struct RuntimeLimits {
    pub memory_bytes: usize,
    pub time_per_invocation: Duration,
    pub host_calls_per_invocation: u32,
    /// Host methods that never count toward the per-invocation budget.
    pub uncounted_host_methods: Vec<String>,
    /// Largest accepted invocation result (JSON bytes).
    pub max_result_bytes: usize,
    pub stack_bytes: usize,
}

pub(crate) enum Command {
    Invoke {
        invocation: u32,
        function: String,
        args: String,
    },
    Reply {
        id: u32,
        result: Result<String, String>,
    },
    /// Wakes the thread after `Shared::cancel`.
    Wake,
    Dispose,
}

#[derive(Debug)]
pub(crate) enum Settlement {
    Value(String),
    Failed(String),
    TimedOut,
    Cancelled,
    MemoryLimit,
    Disposed,
}

impl Settlement {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Value(_) => "completed",
            Self::Failed(_) => "failed",
            Self::TimedOut => "timed_out",
            Self::Cancelled => "cancelled",
            Self::MemoryLimit => "memory_limit",
            Self::Disposed => "disposed",
        }
    }
}

pub(crate) enum Event {
    /// Preludes evaluated (or failed to); sent exactly once, first.
    Ready(Result<(), String>),
    HostCall {
        invocation: u32,
        id: u32,
        method: String,
        args: String,
    },
    Settled {
        invocation: u32,
        settlement: Settlement,
    },
    /// The thread exited; `reason` is set when it was not a requested dispose.
    Closed(Option<String>),
}

/// Event sink, called on the sandbox thread; must not block.
pub(crate) type EventSink = Box<dyn Fn(Event) + Send>;

/// State shared with the interrupt handler and the cancelling thread.
#[derive(Default)]
pub(crate) struct Shared {
    /// Deadlines of the active invocations.
    active: Mutex<HashMap<u32, Instant>>,
    cancelled: Mutex<HashSet<u32>>,
    cancel_all: AtomicBool,
}

impl Shared {
    /// Marks an invocation (or all) cancelled; the interrupt handler stops running JS.
    pub(crate) fn cancel(&self, invocation: Option<u32>) {
        match invocation {
            Some(id) => {
                self.cancelled.lock().unwrap().insert(id);
            }
            None => self.cancel_all.store(true, Ordering::Release),
        }
    }

    fn interrupted(&self) -> bool {
        let active = self.active.lock().unwrap();
        if active.is_empty() {
            return false;
        }
        let now = Instant::now();
        self.cancel_all.load(Ordering::Acquire)
            || active.values().any(|deadline| now >= *deadline)
            || self
                .cancelled
                .lock()
                .unwrap()
                .iter()
                .any(|id| active.contains_key(id))
    }
}

type Resolvers = (Persistent<Function<'static>>, Persistent<Function<'static>>);

#[derive(Default)]
struct State {
    /// Host call id -> (invocation, resolve, reject).
    pending: HashMap<u32, (u32, Resolvers)>,
    next_id: u32,
    /// Host calls counted so far, per active invocation.
    calls: HashMap<u32, u32>,
    /// Results reported by JS, drained by the loop.
    settled: Vec<(u32, Result<String, String>)>,
}

/// Runs the runtime until disposed, closed or panicked. Always ends with `Event::Closed`.
pub(crate) fn run(
    preludes: Vec<(String, String)>,
    limits: RuntimeLimits,
    commands: Receiver<Command>,
    shared: Arc<Shared>,
    events: EventSink,
) {
    let events = Rc::new(events);
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        serve(preludes, limits, commands, shared, &events)
    }));
    let reason = match outcome {
        Ok(reason) => reason,
        Err(payload) => {
            let detail = payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "unknown panic".into());
            Some(format!("sandbox thread panicked: {detail}"))
        }
    };
    events(Event::Closed(reason));
}

fn serve(
    preludes: Vec<(String, String)>,
    limits: RuntimeLimits,
    commands: Receiver<Command>,
    shared: Arc<Shared>,
    events: &Rc<EventSink>,
) -> Option<String> {
    let exhausted = Arc::new(AtomicBool::new(false));
    let setup = (|| {
        let runtime = Runtime::new_with_alloc(LimitedAllocator {
            limit: limits.memory_bytes,
            used: 0,
            exhausted: exhausted.clone(),
        })
        .map_err(|e| format!("sandbox runtime: {e}"))?;
        runtime.set_max_stack_size(limits.stack_bytes);
        let handler_shared = shared.clone();
        runtime.set_interrupt_handler(Some(Box::new(move || handler_shared.interrupted())));
        let context = Context::full(&runtime).map_err(|e| format!("sandbox context: {e}"))?;
        Ok::<_, String>((runtime, context))
    })();
    let (runtime, context) = match setup {
        Ok(parts) => parts,
        Err(error) => {
            events(Event::Ready(Err(error)));
            return None;
        }
    };

    let state = Rc::new(RefCell::new(State {
        next_id: 1,
        ..State::default()
    }));
    let booted = context.with(|ctx| -> Result<Persistent<Function<'static>>, String> {
        let run_invocation = install(&ctx, &state, &shared, events, &limits)
            .map_err(|e| format!("sandbox setup: {}", describe(&ctx, e)))?;
        for (name, source) in &preludes {
            let mut options = rquickjs::context::EvalOptions::default();
            options.global = true;
            options.strict = false;
            options.filename = Some(name.clone());
            ctx.eval_with_options::<(), _>(source.as_str(), options)
                .map_err(|e| describe(&ctx, e))?;
        }
        Ok(Persistent::save(&ctx, run_invocation))
    });
    let run_invocation = match booted {
        Ok(function) => function,
        Err(error) => {
            let error = if exhausted.load(Ordering::Acquire) {
                "sandbox exceeded its memory limit while loading".to_string()
            } else {
                error
            };
            events(Event::Ready(Err(error)));
            return None;
        }
    };
    events(Event::Ready(Ok(())));

    let mut closing: Option<(Settlement, Option<String>)> = None;
    loop {
        drain_jobs(&runtime);
        // An allocator refusal outranks any error it caused inside JS.
        if exhausted.load(Ordering::Acquire) {
            closing = Some((
                Settlement::MemoryLimit,
                Some(format!(
                    "sandbox exceeded the {} MiB memory limit",
                    limits.memory_bytes / (1024 * 1024)
                )),
            ));
        } else {
            flush_settled(&state, &shared, events);
            reap(&state, &shared, events);
        }
        if closing.is_some() {
            break;
        }

        let earliest = shared.active.lock().unwrap().values().min().copied();
        let command = match earliest {
            None => commands.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(deadline) => {
                commands.recv_timeout(deadline.saturating_duration_since(Instant::now()))
            }
        };
        match command {
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) | Ok(Command::Dispose) => {
                closing = Some((Settlement::Disposed, None));
            }
            Ok(Command::Wake) => {}
            Ok(Command::Reply { id, result }) => {
                let entry = state.borrow_mut().pending.remove(&id);
                if let Some((_, (resolve, reject))) = entry {
                    context.with(|ctx| {
                        let call = match result {
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
            Ok(Command::Invoke {
                invocation,
                function,
                args,
            }) => {
                {
                    let mut state = state.borrow_mut();
                    state.calls.insert(invocation, 0);
                }
                shared
                    .active
                    .lock()
                    .unwrap()
                    .insert(invocation, Instant::now() + limits.time_per_invocation);
                context.with(|ctx| {
                    let started = run_invocation
                        .clone()
                        .restore(&ctx)
                        .and_then(|f| f.call::<_, ()>((invocation, function, args)));
                    if let Err(error) = started {
                        // An interrupt or OOM here is handled by reap / the memory check.
                        let _ = describe(&ctx, error);
                    }
                });
            }
        }
    }

    // Closing: fail what is still in flight, then release JS handles while the runtime lives.
    if let Some((settlement, reason)) = closing {
        let ids: Vec<u32> = shared.active.lock().unwrap().keys().copied().collect();
        for invocation in ids {
            let settlement = match &settlement {
                Settlement::MemoryLimit => Settlement::MemoryLimit,
                _ => Settlement::Disposed,
            };
            finish(&state, &shared, events, invocation, settlement);
        }
        state.borrow_mut().pending.clear();
        drop(run_invocation);
        drop(context);
        drop(runtime);
        return reason;
    }
    None
}

/// Runs microtasks until the queue is empty. Job errors are ignored: the invocation
/// wrapper catches everything, so only interrupts and OOM surface here.
fn drain_jobs(runtime: &Runtime) {
    loop {
        match runtime.execute_pending_job() {
            Ok(true) => continue,
            Ok(false) => break,
            Err(job) => {
                job.0.with(|ctx| {
                    let _ = describe_value(&ctx, ctx.catch());
                });
            }
        }
    }
}

fn flush_settled(state: &Rc<RefCell<State>>, shared: &Shared, events: &Rc<EventSink>) {
    let settled = std::mem::take(&mut state.borrow_mut().settled);
    for (invocation, result) in settled {
        let settlement = match result {
            Ok(value) => Settlement::Value(value),
            Err(message) => Settlement::Failed(message),
        };
        finish(state, shared, events, invocation, settlement);
    }
}

/// Fails invocations whose deadline passed or that were cancelled.
fn reap(state: &Rc<RefCell<State>>, shared: &Shared, events: &Rc<EventSink>) {
    let now = Instant::now();
    let cancel_all = shared.cancel_all.swap(false, Ordering::AcqRel);
    let cancelled = std::mem::take(&mut *shared.cancelled.lock().unwrap());
    let due: Vec<(u32, Settlement)> = shared
        .active
        .lock()
        .unwrap()
        .iter()
        .filter_map(|(id, deadline)| {
            if cancel_all || cancelled.contains(id) {
                Some((*id, Settlement::Cancelled))
            } else if now >= *deadline {
                Some((*id, Settlement::TimedOut))
            } else {
                None
            }
        })
        .collect();
    for (invocation, settlement) in due {
        finish(state, shared, events, invocation, settlement);
    }
}

/// Ends an active invocation once: drops its host calls and reports the settlement.
/// A late JS result for an ended invocation is ignored.
fn finish(
    state: &Rc<RefCell<State>>,
    shared: &Shared,
    events: &Rc<EventSink>,
    invocation: u32,
    settlement: Settlement,
) {
    if shared.active.lock().unwrap().remove(&invocation).is_none() {
        return;
    }
    {
        let mut state = state.borrow_mut();
        state.calls.remove(&invocation);
        state.pending.retain(|_, (owner, _)| *owner != invocation);
    }
    events(Event::Settled {
        invocation,
        settlement,
    });
}

/// Installs `__hostCall`, the internal result channel and returns the invocation wrapper
/// `(invocation, functionName, argsJson)`.
fn install<'js>(
    ctx: &Ctx<'js>,
    state: &Rc<RefCell<State>>,
    shared: &Arc<Shared>,
    events: &Rc<EventSink>,
    limits: &RuntimeLimits,
) -> rquickjs::Result<Function<'js>> {
    let globals = ctx.globals();

    let max_result = limits.max_result_bytes;
    let settle_state = state.clone();
    globals.set(
        "__settle",
        Function::new(
            ctx.clone(),
            move |invocation: u32, ok: bool, value: String| {
                let result = if !ok {
                    Err(value)
                } else if value.len() > max_result {
                    Err(format!("result exceeds the {max_result} byte limit"))
                } else {
                    Ok(value)
                };
                settle_state.borrow_mut().settled.push((invocation, result));
            },
        )?,
    )?;

    let budget = limits.host_calls_per_invocation;
    let uncounted = limits.uncounted_host_methods.clone();
    let call_state = state.clone();
    let call_shared = shared.clone();
    let call_events = events.clone();
    globals.set(
        "__hostCall",
        Function::new(
            ctx.clone(),
            move |ctx: Ctx<'js>,
                  method: String,
                  args: String,
                  invocation: Opt<Option<u32>>|
                  -> rquickjs::Result<Promise<'js>> {
                let throw = |message: String| rquickjs::Exception::throw_range(&ctx, &message);
                let id = {
                    let active = call_shared.active.lock().unwrap();
                    let invocation = match invocation.0.flatten() {
                        Some(id) if active.contains_key(&id) => id,
                        Some(_) => return Err(throw("invocation has ended".into())),
                        None if active.len() == 1 => *active.keys().next().unwrap(),
                        None => return Err(throw("host call without an invocation id".into())),
                    };
                    drop(active);
                    let mut state = call_state.borrow_mut();
                    if !uncounted.contains(&method) {
                        let calls = state.calls.entry(invocation).or_insert(0);
                        if *calls >= budget {
                            return Err(throw(format!("host call limit of {budget} reached")));
                        }
                        *calls += 1;
                    }
                    let id = state.next_id;
                    state.next_id += 1;
                    (invocation, id)
                };
                let (invocation, id) = id;
                let (promise, resolve, reject) = Promise::new(&ctx)?;
                call_state.borrow_mut().pending.insert(
                    id,
                    (
                        invocation,
                        (
                            Persistent::save(&ctx, resolve),
                            Persistent::save(&ctx, reject),
                        ),
                    ),
                );
                call_events(Event::HostCall {
                    invocation,
                    id,
                    method,
                    args,
                });
                Ok(promise)
            },
        )?,
    )?;

    // Runs `globalThis[name](JSON.parse(args), invocation)` and reports through `__settle`.
    let wrapper: Function = ctx.eval(
        r#"(() => {
  const settle = __settle;
  delete globalThis.__settle;
  return (invocation, name, args) => {
    (async () => {
      const fn = globalThis[name];
      if (typeof fn !== "function") throw new Error(name + " is not a function");
      const value = await fn(JSON.parse(args), invocation);
      return JSON.stringify(value === undefined ? null : value);
    })().then(
      (json) => settle(invocation, true, json),
      (error) => settle(invocation, false, error instanceof Error ? error.message : String(error)),
    );
  };
})()"#,
    )?;
    Ok(wrapper)
}
