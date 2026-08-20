use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use fs2::FileExt;
use nerve_process_core::{
    Containment, ManagedProcess, ManagedProcessEvents, ManagedTarget, ProcessPriority,
    SpawnOptions, TerminationResult, capabilities, spawn, terminate,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const PROTOCOL_VERSION: u32 = 2;
const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
const MAX_READ_BYTES: usize = 64 * 1024;
const MAX_READ_EVENTS: usize = 256;
const TERMINAL_RETENTION_MS: u64 = 7 * 24 * 60 * 60 * 1_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    version: u32,
    token: String,
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    version: u32,
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<WorkerError>,
}

#[derive(Serialize)]
struct WorkerError {
    code: String,
    message: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartParams {
    execution_id: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    env: Option<HashMap<String, String>>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    #[serde(default = "default_grace_ms")]
    termination_grace_ms: u64,
    #[serde(default = "default_below_normal")]
    below_normal_priority: bool,
}

fn default_grace_ms() -> u64 {
    2_000
}

fn default_below_normal() -> bool {
    true
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionIdParams {
    execution_id: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReadParams {
    execution_id: String,
    #[serde(default)]
    after_cursor: u64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SubscribeParams {
    execution_id: String,
    #[serde(default)]
    after_cursor: u64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CancelParams {
    execution_id: String,
    #[serde(default = "default_cancel_signal")]
    signal: String,
}

fn default_cancel_signal() -> String {
    "SIGTERM".to_string()
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TargetSnapshot {
    pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    process_group_id: Option<u32>,
    containment: String,
    identity: String,
}

impl From<ManagedTarget> for TargetSnapshot {
    fn from(value: ManagedTarget) -> Self {
        Self {
            pid: value.pid,
            process_group_id: value.process_group_id,
            containment: value.containment.as_str().to_string(),
            identity: value.identity,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecutionSnapshot {
    execution_id: String,
    launch_hash: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<TargetSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signal: Option<String>,
    cursor: u64,
    total_bytes: u64,
    started_at_ms: u64,
    updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputEvent {
    cursor: u64,
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    signal: Option<String>,
}

struct OutputStore {
    journal: File,
    stdout: File,
    stderr: File,
    combined: File,
}

struct Execution {
    dir: PathBuf,
    snapshot: Mutex<ExecutionSnapshot>,
    output: Mutex<OutputStore>,
    process: Mutex<Option<Arc<ManagedProcess>>>,
    journal_offsets: Mutex<Vec<u64>>,
}

impl Execution {
    fn record_output(&self, stream: &str, chunk: &[u8]) -> Result<(), String> {
        let mut snapshot = self.snapshot.lock().map_err(lock_error)?;
        let mut output = self.output.lock().map_err(lock_error)?;
        snapshot.cursor += 1;
        snapshot.total_bytes = snapshot.total_bytes.saturating_add(chunk.len() as u64);
        snapshot.updated_at_ms = now_ms();
        match stream {
            "stdout" => output.stdout.write_all(chunk),
            "stderr" => output.stderr.write_all(chunk),
            _ => return Err("Unknown output stream".to_string()),
        }
        .map_err(|error| error.to_string())?;
        output
            .combined
            .write_all(chunk)
            .map_err(|error| error.to_string())?;
        let event = OutputEvent {
            cursor: snapshot.cursor,
            kind: "output".to_string(),
            stream: Some(stream.to_string()),
            data_base64: Some(base64::engine::general_purpose::STANDARD.encode(chunk)),
            status: None,
            exit_code: None,
            signal: None,
        };
        append_json_line(&mut output.journal, &event)?;
        let position = output
            .journal
            .stream_position()
            .map_err(|error| error.to_string())?;
        self.journal_offsets
            .lock()
            .map_err(lock_error)?
            .push(position);
        Ok(())
    }

    fn record_terminal(&self, exit_code: i32, signal: String) -> Result<(), String> {
        let mut snapshot = self.snapshot.lock().map_err(lock_error)?;
        let mut output = self.output.lock().map_err(lock_error)?;
        if snapshot.status != "running" && snapshot.status != "starting" {
            return Ok(());
        }
        snapshot.cursor += 1;
        snapshot.status = if exit_code == 0 && signal.is_empty() {
            "completed".to_string()
        } else {
            "failed".to_string()
        };
        snapshot.exit_code = Some(exit_code);
        snapshot.signal = if signal.is_empty() {
            None
        } else {
            Some(signal.clone())
        };
        snapshot.updated_at_ms = now_ms();
        let event = OutputEvent {
            cursor: snapshot.cursor,
            kind: "terminal".to_string(),
            stream: None,
            data_base64: None,
            status: Some(snapshot.status.clone()),
            exit_code: Some(exit_code),
            signal: snapshot.signal.clone(),
        };
        append_json_line(&mut output.journal, &event)?;
        let position = output
            .journal
            .stream_position()
            .map_err(|error| error.to_string())?;
        self.journal_offsets
            .lock()
            .map_err(lock_error)?
            .push(position);
        output
            .journal
            .sync_data()
            .map_err(|error| error.to_string())?;
        output
            .stdout
            .sync_data()
            .map_err(|error| error.to_string())?;
        output
            .stderr
            .sync_data()
            .map_err(|error| error.to_string())?;
        output
            .combined
            .sync_data()
            .map_err(|error| error.to_string())?;
        persist_snapshot(&self.dir, &snapshot)
    }

    fn mark_error(&self, error: String) {
        if let Ok(mut snapshot) = self.snapshot.lock() {
            snapshot.status = "failed".to_string();
            snapshot.error = Some(error);
            snapshot.updated_at_ms = now_ms();
            let _ = persist_snapshot(&self.dir, &snapshot);
        }
    }
}

struct Registry {
    home: PathBuf,
    executions: Mutex<HashMap<String, Arc<Execution>>>,
}

impl Registry {
    fn new(home: PathBuf) -> Result<Self, String> {
        let root = home.join("execution-runtime").join("executions");
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        let registry = Self {
            home,
            executions: Mutex::new(HashMap::new()),
        };
        registry.hydrate()?;
        Ok(registry)
    }

    fn has_active_executions(&self) -> bool {
        self.executions
            .lock()
            .map(|executions| {
                executions.values().any(|execution| {
                    execution
                        .snapshot
                        .lock()
                        .map(|snapshot| matches!(snapshot.status.as_str(), "starting" | "running"))
                        .unwrap_or(true)
                })
            })
            .unwrap_or(true)
    }

    fn hydrate(&self) -> Result<(), String> {
        let root = self.home.join("execution-runtime").join("executions");
        let mut executions = self.executions.lock().map_err(lock_error)?;
        for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                continue;
            }
            let dir = entry.path();
            let state_path = dir.join("state.json");
            let raw = match fs::read(&state_path) {
                Ok(raw) => raw,
                Err(_) => continue,
            };
            let mut snapshot: ExecutionSnapshot = match serde_json::from_slice(&raw) {
                Ok(snapshot) => snapshot,
                Err(_) => continue,
            };
            if !matches!(snapshot.status.as_str(), "starting" | "running")
                && now_ms().saturating_sub(snapshot.updated_at_ms) > TERMINAL_RETENTION_MS
            {
                let _ = fs::remove_dir_all(&dir);
                continue;
            }
            if matches!(snapshot.status.as_str(), "starting" | "running") {
                let recovery = snapshot.target.as_ref().map(|target| {
                    terminate(
                        &ManagedTarget {
                            pid: target.pid,
                            process_group_id: target.process_group_id,
                            containment: Containment::from_boundary(target.containment.clone()),
                            identity: target.identity.clone(),
                        },
                        "SIGKILL",
                    )
                });
                snapshot.status = "failed".to_string();
                snapshot.error = Some(match recovery {
                    Some(result) if result.terminated => {
                        "Execution worker restarted and safely terminated the surviving process tree"
                            .to_string()
                    }
                    Some(result) if result.attempted => result.error.unwrap_or_else(|| {
                        "Execution worker restart cleanup could not verify termination".to_string()
                    }),
                    Some(_) => "Execution worker restarted after the process had exited or its identity no longer matched".to_string(),
                    None => "Execution worker restarted before process identity was captured".to_string(),
                });
                snapshot.updated_at_ms = now_ms();
                let _ = persist_snapshot(&dir, &snapshot);
            }
            let journal_offsets = journal_offsets(&dir.join("events.jsonl"))?;
            let output = open_output_store(&dir)?;
            executions.insert(
                snapshot.execution_id.clone(),
                Arc::new(Execution {
                    dir,
                    snapshot: Mutex::new(snapshot),
                    output: Mutex::new(output),
                    process: Mutex::new(None),
                    journal_offsets: Mutex::new(journal_offsets),
                }),
            );
        }
        Ok(())
    }

    fn start(&self, params: StartParams) -> Result<ExecutionSnapshot, String> {
        validate_execution_id(&params.execution_id)?;
        let launch_hash = launch_hash(&params)?;
        {
            let executions = self.executions.lock().map_err(lock_error)?;
            if let Some(existing) = executions.get(&params.execution_id) {
                let snapshot = existing.snapshot.lock().map_err(lock_error)?.clone();
                return if snapshot.launch_hash == launch_hash {
                    Ok(snapshot)
                } else {
                    Err("EXECUTION_ID_CONFLICT: launch parameters differ".to_string())
                };
            }
        }

        let dir = self
            .home
            .join("execution-runtime")
            .join("executions")
            .join(&params.execution_id);
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let started_at_ms = now_ms();
        let execution = Arc::new(Execution {
            dir: dir.clone(),
            snapshot: Mutex::new(ExecutionSnapshot {
                execution_id: params.execution_id.clone(),
                launch_hash,
                status: "starting".to_string(),
                target: None,
                exit_code: None,
                signal: None,
                cursor: 0,
                total_bytes: 0,
                started_at_ms,
                updated_at_ms: started_at_ms,
                error: None,
            }),
            output: Mutex::new(open_output_store(&dir)?),
            process: Mutex::new(None),
            journal_offsets: Mutex::new(vec![0]),
        });
        {
            let snapshot = execution.snapshot.lock().map_err(lock_error)?;
            persist_snapshot(&dir, &snapshot)?;
        }
        self.executions
            .lock()
            .map_err(lock_error)?
            .insert(params.execution_id.clone(), Arc::clone(&execution));

        let stdout_execution = Arc::clone(&execution);
        let stderr_execution = Arc::clone(&execution);
        let terminal_execution = Arc::clone(&execution);
        let process = spawn(
            params.command,
            params.args,
            SpawnOptions {
                cwd: params.cwd,
                env: params.env,
                priority: if params.below_normal_priority {
                    ProcessPriority::BelowNormal
                } else {
                    ProcessPriority::Normal
                },
            },
            ManagedProcessEvents::new(
                move |chunk| {
                    if let Err(error) = stdout_execution.record_output("stdout", &chunk) {
                        stdout_execution.mark_error(error);
                    }
                },
                move |chunk| {
                    if let Err(error) = stderr_execution.record_output("stderr", &chunk) {
                        stderr_execution.mark_error(error);
                    }
                },
                |_result| {},
                move |(code, signal)| {
                    if let Err(error) = terminal_execution.record_terminal(code, signal) {
                        terminal_execution.mark_error(error);
                    }
                },
            ),
        )
        .inspect_err(|error| execution.mark_error(error.clone()))?;
        let process = Arc::new(process);
        {
            let mut snapshot = execution.snapshot.lock().map_err(lock_error)?;
            snapshot.status = "running".to_string();
            snapshot.target = Some(process.target().into());
            snapshot.updated_at_ms = now_ms();
            persist_snapshot(&dir, &snapshot)?;
        }
        *execution.process.lock().map_err(lock_error)? = Some(Arc::clone(&process));

        if let Some(timeout_ms) = params.timeout_ms {
            let timeout_execution = Arc::clone(&execution);
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(timeout_ms));
                let running = timeout_execution
                    .snapshot
                    .lock()
                    .map(|snapshot| snapshot.status == "running")
                    .unwrap_or(false);
                if !running {
                    return;
                }
                if process.terminate("SIGTERM").terminated {
                    thread::sleep(Duration::from_millis(params.termination_grace_ms));
                }
                let still_running = timeout_execution
                    .snapshot
                    .lock()
                    .map(|snapshot| snapshot.status == "running")
                    .unwrap_or(false);
                if still_running {
                    let _ = process.terminate("SIGKILL");
                }
            });
        }
        execution
            .snapshot
            .lock()
            .map_err(lock_error)
            .map(|value| value.clone())
    }

    fn get(&self, id: &str) -> Result<Option<ExecutionSnapshot>, String> {
        let executions = self.executions.lock().map_err(lock_error)?;
        executions
            .get(id)
            .map(|execution| {
                execution
                    .snapshot
                    .lock()
                    .map_err(lock_error)
                    .map(|value| value.clone())
            })
            .transpose()
    }

    fn list(&self) -> Result<Vec<ExecutionSnapshot>, String> {
        let executions = self.executions.lock().map_err(lock_error)?;
        executions
            .values()
            .map(|execution| {
                execution
                    .snapshot
                    .lock()
                    .map_err(lock_error)
                    .map(|value| value.clone())
            })
            .collect()
    }

    fn read(&self, params: &ReadParams) -> Result<Value, String> {
        let executions = self.executions.lock().map_err(lock_error)?;
        let execution = executions
            .get(&params.execution_id)
            .ok_or_else(|| "EXECUTION_NOT_FOUND".to_string())?;
        let (events, _cursor, snapshot) = read_events(execution, params.after_cursor)?;
        Ok(json!({ "events": events, "snapshot": snapshot }))
    }

    /// Stream an execution's output to a client as it is produced. The client
    /// stays a passive reader; the worker pushes frames (already length-prefixed
    /// JSON responses) until the execution becomes terminal.
    fn subscribe(
        &self,
        stream: &mut TcpStream,
        id: &str,
        params: &SubscribeParams,
    ) -> Result<(), String> {
        let execution = {
            let executions = self.executions.lock().map_err(lock_error)?;
            executions
                .get(&params.execution_id)
                .cloned()
                .ok_or_else(|| "EXECUTION_NOT_FOUND".to_string())?
        };
        let initial_snapshot = execution.snapshot.lock().map_err(lock_error)?.clone();
        self.write_push(
            stream,
            id,
            json!({
                "executionId": params.execution_id,
                "kind": "ack",
                "cursor": params.after_cursor,
                "snapshot": initial_snapshot,
            }),
        )?;
        let mut cursor = params.after_cursor;
        let mut last_push = Instant::now();
        loop {
            let (events, new_cursor, _snapshot) = read_events(&execution, cursor)?;
            if !events.is_empty() {
                self.write_push(
                    stream,
                    id,
                    json!({
                        "executionId": params.execution_id,
                        "kind": "output",
                        "events": events,
                        "cursor": new_cursor,
                    }),
                )?;
                cursor = new_cursor;
                last_push = Instant::now();
            }
            let terminal = {
                let snapshot = execution.snapshot.lock().map_err(lock_error)?.clone();
                if matches!(snapshot.status.as_str(), "completed" | "failed") {
                    self.write_push(
                        stream,
                        id,
                        json!({
                            "executionId": params.execution_id,
                            "kind": "terminal",
                            "snapshot": snapshot,
                        }),
                    )?;
                    true
                } else if last_push.elapsed() >= Duration::from_millis(2_000) {
                    // Heartbeat so an idle-but-running stream stays alive and
                    // reflects live status without client-side polling.
                    self.write_push(
                        stream,
                        id,
                        json!({
                            "executionId": params.execution_id,
                            "kind": "snapshot",
                            "snapshot": snapshot,
                        }),
                    )?;
                    last_push = Instant::now();
                    false
                } else {
                    false
                }
            };
            if terminal {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn write_push(&self, stream: &mut TcpStream, id: &str, result: Value) -> Result<(), String> {
        write_response(
            stream,
            Response {
                version: PROTOCOL_VERSION,
                id: id.to_string(),
                ok: true,
                result: Some(result),
                error: None,
            },
        )
    }

    fn cancel(&self, params: &CancelParams) -> Result<TerminationResult, String> {
        let executions = self.executions.lock().map_err(lock_error)?;
        let execution = executions
            .get(&params.execution_id)
            .ok_or_else(|| "EXECUTION_NOT_FOUND".to_string())?;
        let process = execution.process.lock().map_err(lock_error)?;
        Ok(match process.as_ref() {
            Some(process) => process.terminate(&params.signal),
            None => TerminationResult::not_attempted(
                nerve_process_core::TerminationMethod::None,
                Some("Execution process is not attached".to_string()),
            ),
        })
    }

    fn remove(&self, id: &str) -> Result<(), String> {
        let mut executions = self.executions.lock().map_err(lock_error)?;
        let execution = executions
            .get(id)
            .ok_or_else(|| "EXECUTION_NOT_FOUND".to_string())?;
        let status = execution
            .snapshot
            .lock()
            .map_err(lock_error)?
            .status
            .clone();
        if matches!(status.as_str(), "starting" | "running") {
            return Err("EXECUTION_ACTIVE".to_string());
        }
        let execution = executions.remove(id).expect("execution existed");
        fs::remove_dir_all(&execution.dir).map_err(|error| error.to_string())
    }
}

fn handle_client(mut stream: TcpStream, registry: Arc<Registry>, token: Arc<String>) {
    loop {
        let request = match read_frame::<Request>(&mut stream) {
            Ok(Some(request)) => request,
            Ok(None) => return,
            Err(error) => {
                let _ = write_response(
                    &mut stream,
                    error_response("unknown", "INVALID_FRAME", error),
                );
                return;
            }
        };
        let response = if request.version != PROTOCOL_VERSION {
            error_response(
                &request.id,
                "VERSION_UNSUPPORTED",
                "Unsupported worker protocol version",
            )
        } else if !constant_time_eq(request.token.as_bytes(), token.as_bytes()) {
            error_response(&request.id, "UNAUTHORIZED", "Worker authentication failed")
        } else if request.method == "execution.subscribe" {
            match parse_params::<SubscribeParams>(request.params) {
                Ok(params) => {
                    // The subscription owns this connection: it writes an ACK
                    // frame, then pushes output/terminal frames until done.
                    if let Err(error) = registry.subscribe(&mut stream, &request.id, &params) {
                        let _ = write_response(
                            &mut stream,
                            error_response(&request.id, "WORKER_ERROR", error),
                        );
                    }
                    return;
                }
                Err(error) => error_response(&request.id, "INVALID_PARAMS", error),
            }
        } else {
            dispatch(&registry, request)
        };
        if write_response(&mut stream, response).is_err() {
            return;
        }
    }
}

fn dispatch(registry: &Registry, request: Request) -> Response {
    let result = match request.method.as_str() {
        "worker.health" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "pid": std::process::id(),
            "capabilities": capabilities(),
            "activeExecutions": registry.list().map(|items| items.into_iter().filter(|item| item.status == "running").count()).unwrap_or(0),
        })),
        "execution.start" => parse_params(request.params)
            .and_then(|params| registry.start(params))
            .and_then(to_value),
        "execution.get" => parse_params::<ExecutionIdParams>(request.params)
            .and_then(|params| registry.get(&params.execution_id))
            .and_then(to_value),
        "execution.list" => registry.list().and_then(to_value),
        "execution.read" => {
            parse_params::<ReadParams>(request.params).and_then(|params| registry.read(&params))
        }
        "execution.cancel" => parse_params::<CancelParams>(request.params)
            .and_then(|params| registry.cancel(&params))
            .map(termination_value),
        "execution.remove" => parse_params::<ExecutionIdParams>(request.params)
            .and_then(|params| registry.remove(&params.execution_id))
            .map(|()| json!({})),
        _ => Err(format!("METHOD_NOT_FOUND: {}", request.method)),
    };
    match result {
        Ok(result) => Response {
            version: PROTOCOL_VERSION,
            id: request.id,
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => {
            let (code, message) = error
                .split_once(": ")
                .unwrap_or(("WORKER_ERROR", error.as_str()));
            error_response(&request.id, code, message)
        }
    }
}

fn parse_params<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| format!("INVALID_PARAMS: {error}"))
}

fn to_value<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| error.to_string())
}

fn termination_value(value: TerminationResult) -> Value {
    json!({
        "attempted": value.attempted,
        "terminated": value.terminated,
        "method": value.method.as_str(),
        "error": value.error,
    })
}

fn error_response(id: &str, code: &str, message: impl Into<String>) -> Response {
    Response {
        version: PROTOCOL_VERSION,
        id: id.to_string(),
        ok: false,
        result: None,
        error: Some(WorkerError {
            code: code.to_string(),
            message: message.into(),
        }),
    }
}

fn read_frame<T: for<'de> Deserialize<'de>>(stream: &mut TcpStream) -> Result<Option<T>, String> {
    let mut header = [0_u8; 4];
    match stream.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error.to_string()),
    }
    let length = u32::from_be_bytes(header) as usize;
    if length == 0 || length > MAX_FRAME_BYTES {
        return Err("Worker frame length is invalid".to_string());
    }
    let mut payload = vec![0_u8; length];
    stream
        .read_exact(&mut payload)
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&payload)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn write_response(stream: &mut TcpStream, response: Response) -> Result<(), String> {
    let payload = serde_json::to_vec(&response).map_err(|error| error.to_string())?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err("Worker response exceeds frame limit".to_string());
    }
    stream
        .write_all(&(payload.len() as u32).to_be_bytes())
        .and_then(|()| stream.write_all(&payload))
        .map_err(|error| error.to_string())
}

fn read_events(
    execution: &Execution,
    after_cursor: u64,
) -> Result<(Vec<OutputEvent>, u64, ExecutionSnapshot), String> {
    let journal_path = execution.dir.join("events.jsonl");
    let (offset, committed_end) = {
        let offsets = execution.journal_offsets.lock().map_err(lock_error)?;
        (
            offsets
                .get(after_cursor as usize)
                .copied()
                .or_else(|| offsets.last().copied())
                .unwrap_or(0),
            offsets.last().copied().unwrap_or(0),
        )
    };
    let (events, cursor) =
        read_committed_events(&journal_path, offset, committed_end, after_cursor)?;
    let snapshot = execution.snapshot.lock().map_err(lock_error)?.clone();
    Ok((events, cursor, snapshot))
}

fn read_committed_events(
    journal_path: &Path,
    offset: u64,
    committed_end: u64,
    after_cursor: u64,
) -> Result<(Vec<OutputEvent>, u64), String> {
    let mut file = File::open(journal_path).map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    let committed_bytes = committed_end.saturating_sub(offset);
    let mut events = Vec::new();
    let mut bytes = 0;
    let mut cursor = after_cursor;
    for line in BufReader::new(file.take(committed_bytes)).lines() {
        let line = line.map_err(|error| error.to_string())?;
        let event: OutputEvent = serde_json::from_str(&line).map_err(|error| error.to_string())?;
        if event.cursor <= after_cursor {
            continue;
        }
        bytes += line.len();
        cursor = cursor.max(event.cursor);
        events.push(event);
        if events.len() >= MAX_READ_EVENTS || bytes >= MAX_READ_BYTES {
            break;
        }
    }
    Ok((events, cursor))
}

fn journal_offsets(path: &Path) -> Result<Vec<u64>, String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![0]),
        Err(error) => return Err(error.to_string()),
    };
    let mut reader = BufReader::new(file);
    let mut offsets = vec![0];
    let mut position = 0_u64;
    loop {
        let mut line = Vec::new();
        let read = reader
            .read_until(b'\n', &mut line)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        position = position.saturating_add(read as u64);
        offsets.push(position);
    }
    Ok(offsets)
}

fn open_output_store(dir: &Path) -> Result<OutputStore, String> {
    Ok(OutputStore {
        journal: append_file(&dir.join("events.jsonl"))?,
        stdout: append_file(&dir.join("stdout.log"))?,
        stderr: append_file(&dir.join("stderr.log"))?,
        combined: append_file(&dir.join("combined.log"))?,
    })
}

fn append_file(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .open(path)
        .map_err(|error| error.to_string())
}

fn append_json_line(file: &mut File, value: &impl Serialize) -> Result<(), String> {
    serde_json::to_writer(&mut *file, value).map_err(|error| error.to_string())?;
    file.write_all(b"\n").map_err(|error| error.to_string())
}

fn persist_snapshot(dir: &Path, snapshot: &ExecutionSnapshot) -> Result<(), String> {
    let temp = dir.join("state.json.tmp");
    let target = dir.join("state.json");
    let payload = serde_json::to_vec_pretty(snapshot).map_err(|error| error.to_string())?;
    let mut file = File::create(&temp).map_err(|error| error.to_string())?;
    file.write_all(&payload)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    fs::rename(temp, target).map_err(|error| error.to_string())
}

fn launch_hash(params: &StartParams) -> Result<String, String> {
    let payload = serde_json::to_vec(params).map_err(|error| error.to_string())?;
    Ok(format!("sha256:{:x}", Sha256::digest(payload)))
}

fn validate_execution_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err("INVALID_EXECUTION_ID".to_string());
    }
    Ok(())
}

fn lock_error<T>(error: std::sync::PoisonError<T>) -> String {
    error.to_string()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn worker_home() -> Result<PathBuf, String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--home" {
            return args
                .next()
                .map(PathBuf::from)
                .ok_or_else(|| "--home requires a path".to_string());
        }
    }
    std::env::var_os("NERVE_HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "NERVE_HOME or --home is required".to_string())
}

fn load_or_create_token(home: &Path) -> Result<String, String> {
    let auth = home.join("auth");
    fs::create_dir_all(&auth).map_err(|error| error.to_string())?;
    let path = auth.join("execution-worker-token");
    if let Ok(token) = fs::read_to_string(&path)
        && !token.trim().is_empty()
    {
        return Ok(token.trim().to_string());
    }
    let bytes: [u8; 32] = rand::random();
    let token = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&path) {
        Ok(mut file) => {
            file.write_all(token.as_bytes())
                .map_err(|error| error.to_string())?;
            file.sync_all().map_err(|error| error.to_string())?;
            Ok(token)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => fs::read_to_string(path)
            .map(|value| value.trim().to_string())
            .map_err(|error| error.to_string()),
        Err(error) => Err(error.to_string()),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerMetadata {
    protocol_version: u32,
    pid: u32,
    host: &'static str,
    port: u16,
    started_at_ms: u64,
}

fn write_metadata(home: &Path, address: std::net::SocketAddr) -> Result<(), String> {
    let runtime = home.join("execution-runtime");
    fs::create_dir_all(&runtime).map_err(|error| error.to_string())?;
    let temp = runtime.join("worker.json.tmp");
    let target = runtime.join("worker.json");
    let payload = serde_json::to_vec_pretty(&WorkerMetadata {
        protocol_version: PROTOCOL_VERSION,
        pid: std::process::id(),
        host: "127.0.0.1",
        port: address.port(),
        started_at_ms: now_ms(),
    })
    .map_err(|error| error.to_string())?;
    fs::write(&temp, payload).map_err(|error| error.to_string())?;
    fs::rename(temp, target).map_err(|error| error.to_string())
}

fn run() -> Result<(), String> {
    let home = worker_home()?;
    fs::create_dir_all(home.join("execution-runtime")).map_err(|error| error.to_string())?;
    let lock_path = home.join("execution-runtime").join("worker.lock");
    let lock_file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|error| error.to_string())?;
    lock_file
        .try_lock_exclusive()
        .map_err(|_| "An execution worker already owns this profile".to_string())?;
    let token = Arc::new(load_or_create_token(&home)?);
    let registry = Arc::new(Registry::new(home.clone())?);
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    write_metadata(
        &home,
        listener.local_addr().map_err(|error| error.to_string())?,
    )?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let mut last_activity = Instant::now();
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                last_activity = Instant::now();
                let registry = Arc::clone(&registry);
                let token = Arc::clone(&token);
                thread::spawn(move || handle_client(stream, registry, token));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if last_activity.elapsed() >= Duration::from_secs(60)
                    && !registry.has_active_executions()
                {
                    break;
                }
                thread::sleep(Duration::from_millis(5));
            }
            Err(error) => eprintln!("Execution worker connection failed: {error}"),
        }
    }
    let _ = fs::remove_file(home.join("execution-runtime").join("worker.json"));
    drop(lock_file);
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Nerve execution worker failed: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        Request, StartParams, constant_time_eq, read_committed_events, validate_execution_id,
    };

    #[test]
    fn validates_execution_ids() {
        assert!(validate_execution_id("task_01ABC-2").is_ok());
        assert!(validate_execution_id("../escape").is_err());
    }

    #[test]
    fn parses_shared_start_request_fixture() {
        let fixture =
            include_str!("../../../contracts/fixtures/execution-worker/start-request.json");
        let request: Request = serde_json::from_str(fixture).expect("request fixture");
        assert_eq!(request.method, "execution.start");
        let start: StartParams =
            serde_json::from_value(request.params).expect("start params fixture");
        assert_eq!(start.execution_id, "tool_fixture");
        assert!(start.below_normal_priority);
    }

    #[test]
    fn ignores_an_uncommitted_partial_journal_line() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nerve-worker-journal-{}-{unique}.jsonl",
            std::process::id()
        ));
        let committed = concat!(
            r#"{"cursor":1,"kind":"output","stream":"stdout","dataBase64":"b2s="}"#,
            "\n"
        );
        fs::write(&path, format!("{committed}{{\"cursor\":2,\"kind\":\"out"))
            .expect("write journal fixture");

        let result = read_committed_events(&path, 0, committed.len() as u64, 0);
        let _ = fs::remove_file(&path);

        let (events, cursor) = result.expect("read committed journal events");
        assert_eq!(events.len(), 1);
        assert_eq!(cursor, 1);
    }

    #[test]
    fn compares_tokens_without_early_content_exit() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }
}
