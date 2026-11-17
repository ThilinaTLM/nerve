use super::*;
use std::sync::Mutex;
use std::sync::mpsc::{Sender, channel};

const PRELUDE: &str = r#"
globalThis.console = { log: (...a) => __print(a.map(v => typeof v === "string" ? v : JSON.stringify(v)).join(" ")) };
globalThis.host = async (method, args) => {
  try { return JSON.parse(await __hostCall(method, JSON.stringify(args ?? null))); }
  catch (e) { throw new Error(String(e)); }
};
"#;

fn limits() -> Limits {
    Limits {
        memory_bytes: 64 * 1024 * 1024,
        timeout: Duration::from_secs(5),
        max_host_calls: 10,
        uncounted_host_methods: Vec::new(),
        max_output_bytes: 4096,
    }
}

/// Runs `code`; `respond` answers each host call from another thread.
fn run_with(
    code: &str,
    limits: Limits,
    respond: impl Fn(u32, &str, &str, &Sender<Message>) + Send + 'static,
) -> (Outcome, Arc<AtomicBool>) {
    let (sender, receiver) = channel();
    let cancelled = Arc::new(AtomicBool::new(false));
    let replies = Mutex::new(sender.clone());
    let host: HostRequest = Box::new(move |id, method, args| {
        let sender = replies.lock().unwrap().clone();
        respond(id, &method, &args, &sender);
    });
    let outcome = run(
        Script {
            preludes: vec![("prelude.js".into(), PRELUDE.into())],
            name: "script.js".into(),
            code: code.into(),
        },
        limits,
        receiver,
        cancelled.clone(),
        host,
    );
    drop(sender);
    (outcome, cancelled)
}

fn echo(id: u32, _method: &str, args: &str, sender: &Sender<Message>) {
    let sender = sender.clone();
    let args = args.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(20));
        let _ = sender.send(Message::Reply {
            id,
            result: Ok(args),
        });
    });
}

#[test]
fn top_level_await_resolves_host_calls_from_another_thread() {
    let (outcome, _) = run_with(
        r#"
        const [a, b] = await Promise.all([host("x", { n: 1 }), host("y", { n: 2 })]);
        console.log(a.n + b.n);
        "#,
        limits(),
        echo,
    );
    assert_eq!(outcome.status, Status::Completed, "{:?}", outcome.error);
    assert_eq!(outcome.output, "3\n");
    assert_eq!(outcome.host_calls, 2);
}

#[test]
fn host_rejection_becomes_a_catchable_error() {
    let (outcome, _) = run_with(
        r#"
        try { await host("denied", {}); } catch (e) { console.log("caught", e.message); }
        "#,
        limits(),
        |id, _, _, sender| {
            let _ = sender.send(Message::Reply {
                id,
                result: Err("jira.issues.delete: denied by user".into()),
            });
        },
    );
    assert_eq!(outcome.status, Status::Completed, "{:?}", outcome.error);
    assert_eq!(
        outcome.output,
        "caught jira.issues.delete: denied by user\n"
    );
}

#[test]
fn uncaught_error_fails_with_message_and_stack() {
    let (outcome, _) = run_with(
        "function f() { throw new TypeError('bad'); }\nf();",
        limits(),
        echo,
    );
    assert_eq!(outcome.status, Status::Failed);
    let error = outcome.error.unwrap();
    assert!(error.starts_with("TypeError: bad"), "{error}");
    assert!(error.contains("script.js"), "{error}");
}

#[test]
fn busy_loop_is_interrupted_at_the_deadline() {
    let mut limits = limits();
    limits.timeout = Duration::from_millis(200);
    let (outcome, _) = run_with("while (true) {}", limits, echo);
    assert_eq!(outcome.status, Status::TimedOut);
    assert!(outcome.duration < Duration::from_secs(2));
}

#[test]
fn waiting_on_the_host_times_out_at_the_deadline() {
    let mut limits = limits();
    limits.timeout = Duration::from_millis(200);
    let (outcome, _) = run_with("await host('never', {});", limits, |_, _, _, _| {});
    assert_eq!(outcome.status, Status::TimedOut);
}

#[test]
fn cancel_message_stops_a_script_waiting_on_the_host() {
    let (outcome, _) = run_with("await host('slow', {});", limits(), |_, _, _, sender| {
        let sender = sender.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            let _ = sender.send(Message::Cancel);
        });
    });
    assert_eq!(outcome.status, Status::Cancelled);
}

#[test]
fn memory_limit_stops_unbounded_allocation() {
    let mut limits = limits();
    limits.memory_bytes = 16 * 1024 * 1024;
    let (outcome, _) = run_with(
        "const a = []; while (true) a.push('x'.repeat(1024) + a.length);",
        limits,
        echo,
    );
    assert_eq!(outcome.status, Status::MemoryLimit, "{:?}", outcome.error);
}

#[test]
fn throwing_null_is_a_failure_not_a_memory_limit() {
    let (outcome, _) = run_with("throw null;", limits(), echo);
    assert_eq!(outcome.status, Status::Failed, "{:?}", outcome.error);
}

#[test]
fn host_call_limit_and_output_cap_are_enforced() {
    let mut limits = limits();
    limits.max_host_calls = 1;
    limits.max_output_bytes = 8;
    let (outcome, _) = run_with(
        r#"
        console.log("12345"); console.log("67890");
        await host("a", 1);
        await host("b", 2);
        "#,
        limits,
        echo,
    );
    assert_eq!(outcome.status, Status::Failed);
    assert!(outcome.error.unwrap().contains("host call limit of 1"));
    assert_eq!(outcome.output, "12345\n");
    assert!(outcome.output_truncated);
}

#[test]
fn uncounted_host_methods_skip_the_call_limit() {
    let mut limits = limits();
    limits.max_host_calls = 2;
    limits.uncounted_host_methods = vec!["tick".to_string()];
    let (outcome, _) = run_with(
        r#"
        for (let i = 0; i < 20; i++) await host("tick", i);
        await host("a", 1);
        await host("b", 2);
        await host("c", 3);
        "#,
        limits,
        echo,
    );
    assert_eq!(outcome.status, Status::Failed);
    assert!(outcome.error.unwrap().contains("host call limit of 2"));
}

#[test]
fn a_promise_that_can_never_settle_fails_fast() {
    let (outcome, _) = run_with("await new Promise(() => {});", limits(), echo);
    assert_eq!(outcome.status, Status::Failed);
    assert!(outcome.error.unwrap().contains("never settle"));
}

#[test]
fn no_ambient_io_globals_exist() {
    let (outcome, _) = run_with(
        r#"console.log([typeof require, typeof process, typeof fetch, typeof setTimeout, typeof std, typeof os].join(","));"#,
        limits(),
        echo,
    );
    assert_eq!(outcome.status, Status::Completed, "{:?}", outcome.error);
    assert_eq!(
        outcome.output,
        "undefined,undefined,undefined,undefined,undefined,undefined\n"
    );
}

#[test]
fn panic_in_the_engine_thread_becomes_a_failed_outcome() {
    let outcome = contain_panic(|| panic!("boom"));
    assert_eq!(outcome.status, Status::Failed);
    assert!(outcome.error.unwrap().contains("boom"));
}

mod persistent_runtime {
    use super::super::persistent::{self, Command, Event, RuntimeLimits, Settlement, Shared};
    use std::sync::Arc;
    use std::sync::mpsc::{Receiver, Sender, channel};
    use std::time::Duration;

    const PRELUDE: &str = r#"
globalThis.host = async (method, args, invocation) => {
  try { return JSON.parse(await __hostCall(method, JSON.stringify(args ?? null), invocation)); }
  catch (e) { throw new Error(String(e)); }
};
globalThis.add = ({ a, b }) => a + b;
globalThis.later = async ({ n }, inv) => (await host("echo", { n }, inv)).n + 1;
globalThis.fail = () => { throw new Error("[BAD_INPUT] nope"); };
globalThis.spin = () => { while (true) {} };
globalThis.hold = (_, inv) => host("never", {}, inv);
globalThis.many = async ({ count }, inv) => { for (let i = 0; i < count; i++) await host("count", i, inv); return count; };
globalThis.leak = () => { const a = []; while (true) a.push("x".repeat(1024) + a.length); };
globalThis.boom = () => undefined;
globalThis.counter = (() => { let n = 0; return () => ++n; })();
"#;

    fn limits() -> RuntimeLimits {
        RuntimeLimits {
            memory_bytes: 64 * 1024 * 1024,
            time_per_invocation: Duration::from_secs(5),
            host_calls_per_invocation: 3,
            uncounted_host_methods: vec!["tick".into()],
            max_result_bytes: 1024,
            stack_bytes: 1024 * 1024,
        }
    }

    struct Harness {
        commands: Sender<Command>,
        shared: Arc<Shared>,
        events: Receiver<Event>,
        thread: Option<std::thread::JoinHandle<()>>,
        ready: Result<(), String>,
    }

    fn open(prelude: &str, limits: RuntimeLimits) -> Harness {
        let (commands, receiver) = channel();
        let (sink, events) = channel();
        let sink = std::sync::Mutex::new(sink);
        let shared = Arc::new(Shared::default());
        let thread_shared = shared.clone();
        let prelude = prelude.to_string();
        let thread = std::thread::spawn(move || {
            persistent::run(
                vec![("prelude.js".into(), prelude)],
                limits,
                receiver,
                thread_shared,
                Box::new(move |event| {
                    let _ = sink.lock().unwrap().send(event);
                }),
            );
        });
        let ready = match events.recv_timeout(Duration::from_secs(5)).unwrap() {
            Event::Ready(result) => result,
            _ => panic!("first event must be Ready"),
        };
        Harness {
            commands,
            shared,
            events,
            thread: Some(thread),
            ready,
        }
    }

    impl Harness {
        fn invoke(&self, invocation: u32, function: &str, args: &str) {
            self.commands
                .send(Command::Invoke {
                    invocation,
                    function: function.into(),
                    args: args.into(),
                })
                .unwrap();
        }

        /// Next settlement; host calls are echoed back unless the method is `never`.
        fn settled(&self) -> (u32, Settlement) {
            loop {
                match self.events.recv_timeout(Duration::from_secs(10)).unwrap() {
                    Event::HostCall {
                        id, method, args, ..
                    } => {
                        if method != "never" {
                            self.commands
                                .send(Command::Reply {
                                    id,
                                    result: Ok(args),
                                })
                                .unwrap();
                        }
                    }
                    Event::Settled {
                        invocation,
                        settlement,
                    } => return (invocation, settlement),
                    Event::Closed(reason) => panic!("closed unexpectedly: {reason:?}"),
                    Event::Ready(_) => unreachable!(),
                }
            }
        }

        fn closed(&self) -> Option<String> {
            loop {
                if let Event::Closed(reason) =
                    self.events.recv_timeout(Duration::from_secs(10)).unwrap()
                {
                    return reason;
                }
            }
        }
    }

    impl Drop for Harness {
        fn drop(&mut self) {
            let _ = self.commands.send(Command::Dispose);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    fn value(settlement: Settlement) -> String {
        match settlement {
            Settlement::Value(json) => json,
            other => panic!("expected a value, got {other:?}"),
        }
    }

    #[test]
    fn invoke_returns_values_and_keeps_state_between_calls() {
        let h = open(PRELUDE, limits());
        assert!(h.ready.is_ok());
        h.invoke(1, "add", r#"{"a":2,"b":3}"#);
        assert_eq!(value(h.settled().1), "5");
        for expected in ["1", "2"] {
            h.invoke(2, "counter", "null");
            assert_eq!(value(h.settled().1), expected);
        }
        h.invoke(3, "boom", "null");
        assert_eq!(value(h.settled().1), "null");
    }

    #[test]
    fn errors_keep_the_thrown_message_and_missing_functions_fail() {
        let h = open(PRELUDE, limits());
        h.invoke(1, "fail", "null");
        match h.settled().1 {
            Settlement::Failed(message) => assert_eq!(message, "[BAD_INPUT] nope"),
            other => panic!("{other:?}"),
        }
        h.invoke(2, "missing", "null");
        assert!(matches!(h.settled().1, Settlement::Failed(m) if m.contains("not a function")));
        h.invoke(3, "add", r#"{"a":1,"b":1}"#);
        assert_eq!(value(h.settled().1), "2");
    }

    #[test]
    fn host_calls_happen_during_an_invocation() {
        let h = open(PRELUDE, limits());
        h.invoke(1, "later", r#"{"n":41}"#);
        assert_eq!(value(h.settled().1), "42");
    }

    #[test]
    fn concurrent_invocations_interleave_with_their_own_budgets() {
        let h = open(PRELUDE, limits());
        h.invoke(1, "many", r#"{"count":3}"#);
        h.invoke(2, "many", r#"{"count":3}"#);
        h.invoke(3, "many", r#"{"count":4}"#);
        let mut results = std::collections::HashMap::new();
        for _ in 0..3 {
            let (id, settlement) = h.settled();
            results.insert(id, settlement);
        }
        // Each invocation has its own budget of 3: the first two fit, the third does not.
        assert_eq!(value(results.remove(&1).unwrap()), "3");
        assert_eq!(value(results.remove(&2).unwrap()), "3");
        assert!(matches!(results.remove(&3).unwrap(),
            Settlement::Failed(m) if m.contains("host call limit of 3")));
    }

    #[test]
    fn host_call_attribution_defaults_to_the_only_active_invocation() {
        let h = open(
            &format!("{PRELUDE}\nglobalThis.implicit = async () => (await host('echo', 7)) + 1;"),
            limits(),
        );
        h.invoke(1, "implicit", "null");
        assert_eq!(value(h.settled().1), "8");
    }

    #[test]
    fn uncounted_methods_skip_the_invocation_budget() {
        let h = open(
            &format!(
                "{PRELUDE}\nglobalThis.ticks = async (_, inv) => {{ for (let i = 0; i < 20; i++) await host('tick', i, inv); return 'ok'; }};"
            ),
            limits(),
        );
        h.invoke(1, "ticks", "null");
        assert_eq!(value(h.settled().1), r#""ok""#);
    }

    #[test]
    fn the_time_limit_is_re_armed_per_invocation() {
        let mut limits = limits();
        limits.time_per_invocation = Duration::from_millis(300);
        let h = open(PRELUDE, limits);
        h.invoke(1, "add", r#"{"a":1,"b":1}"#);
        assert_eq!(value(h.settled().1), "2");
        // The idle gap exceeds the per-invocation limit; the runtime must survive it.
        std::thread::sleep(Duration::from_millis(700));
        h.invoke(2, "add", r#"{"a":2,"b":2}"#);
        assert_eq!(value(h.settled().1), "4");
        // A busy loop is interrupted; a stalled host call times out; both leave the runtime usable.
        h.invoke(3, "spin", "null");
        assert!(matches!(h.settled().1, Settlement::TimedOut));
        h.invoke(4, "hold", "null");
        assert!(matches!(h.settled().1, Settlement::TimedOut));
        h.invoke(5, "add", r#"{"a":3,"b":3}"#);
        assert_eq!(value(h.settled().1), "6");
    }

    #[test]
    fn cancel_stops_one_invocation_or_all() {
        let h = open(PRELUDE, limits());
        h.invoke(1, "hold", "null");
        h.invoke(2, "spin", "null");
        h.invoke(3, "hold", "null");
        std::thread::sleep(Duration::from_millis(100));
        h.shared.cancel(Some(2));
        h.commands.send(Command::Wake).unwrap();
        let (id, settlement) = h.settled();
        assert_eq!(id, 2);
        assert!(matches!(settlement, Settlement::Cancelled));
        h.shared.cancel(None);
        h.commands.send(Command::Wake).unwrap();
        let mut ids = vec![h.settled().0, h.settled().0];
        ids.sort();
        assert_eq!(ids, vec![1, 3]);
        h.invoke(4, "add", r#"{"a":1,"b":2}"#);
        assert_eq!(value(h.settled().1), "3");
    }

    #[test]
    fn dispose_reports_pending_then_closed_without_reason() {
        let h = open(PRELUDE, limits());
        h.invoke(1, "hold", "null");
        std::thread::sleep(Duration::from_millis(50));
        h.commands.send(Command::Dispose).unwrap();
        let mut settled = None;
        let reason = loop {
            match h.events.recv_timeout(Duration::from_secs(10)).unwrap() {
                Event::Settled { settlement, .. } => settled = Some(settlement),
                Event::Closed(reason) => break reason,
                _ => {}
            }
        };
        assert!(matches!(settled, Some(Settlement::Disposed)));
        assert_eq!(reason, None);
    }

    #[test]
    fn memory_limit_fails_the_invocation_and_closes_the_runtime() {
        let mut limits = limits();
        limits.memory_bytes = 16 * 1024 * 1024;
        let h = open(PRELUDE, limits);
        h.invoke(1, "leak", "null");
        assert!(matches!(h.settled().1, Settlement::MemoryLimit));
        let reason = h.closed().expect("closed with a reason");
        assert!(reason.contains("memory limit"), "{reason}");
    }

    #[test]
    fn oversized_results_fail() {
        let h = open(
            &format!("{PRELUDE}\nglobalThis.big = () => 'x'.repeat(5000);"),
            limits(),
        );
        h.invoke(1, "big", "null");
        assert!(matches!(h.settled().1, Settlement::Failed(m) if m.contains("byte limit")));
    }

    #[test]
    fn a_throwing_prelude_fails_open() {
        let h = open("throw new Error('bad bundle');", limits());
        let error = h.ready.clone().unwrap_err();
        assert!(error.contains("bad bundle"), "{error}");
        assert_eq!(h.closed(), None);
    }

    #[test]
    fn panic_is_contained_and_reported_as_closed() {
        let (commands, receiver) = channel();
        let (sink, events) = channel();
        let thread = std::thread::spawn(move || {
            persistent::run(
                vec![],
                limits(),
                receiver,
                Arc::new(Shared::default()),
                Box::new(move |event| {
                    if matches!(event, Event::Ready(_)) {
                        panic!("boom");
                    }
                    let _ = sink.send(event);
                }),
            );
        });
        thread.join().unwrap();
        drop(commands);
        match events.recv_timeout(Duration::from_secs(5)).unwrap() {
            Event::Closed(Some(reason)) => assert!(reason.contains("boom"), "{reason}"),
            _ => panic!("expected Closed with a panic reason"),
        }
    }
}
