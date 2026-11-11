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
