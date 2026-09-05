use std::{
    collections::HashSet,
    io,
    net::{TcpStream, ToSocketAddrs},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use async_channel::{Receiver as EventReceiver, Sender as EventSender};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tungstenite::{
    Message, WebSocket, client::IntoClientRequest, http::HeaderValue, stream::MaybeTlsStream,
};
use url::Url;
use uuid::Uuid;

use super::{
    config::ConnectionConfig,
    models::{ClientConfigResponse, StreamCursor, WorkspaceSnapshotResponse},
};

const REQUIRED_CAPABILITIES: &[&str] = &[
    "encoding.json",
    "event.batch",
    "stream.subscription.v1",
    "snapshot.workspace",
    "operation.snapshot.workspace.get",
];
const RETRY_DELAYS: &[Duration] = &[
    Duration::from_millis(250),
    Duration::from_millis(500),
    Duration::from_secs(1),
    Duration::from_millis(1500),
    Duration::from_millis(2500),
    Duration::from_secs(4),
    Duration::from_secs(5),
];
const IO_POLL_INTERVAL: Duration = Duration::from_millis(500);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug)]
pub enum WorkerEvent {
    Connecting {
        target: String,
    },
    Retrying {
        target: String,
        message: String,
    },
    Live {
        target: String,
    },
    Snapshot {
        user_home: String,
        snapshot: WorkspaceSnapshotResponse,
    },
    Error {
        target: String,
        message: String,
    },
    Closed,
}

pub struct WorkerHandle {
    stop: mpsc::Sender<()>,
    thread: Option<thread::JoinHandle<()>>,
}

impl WorkerHandle {
    pub fn spawn(config: ConnectionConfig) -> (Self, EventReceiver<WorkerEvent>) {
        // State updates are tiny and infrequent. An unbounded channel ensures
        // the worker can always observe shutdown even after the UI receiver is
        // dropped; a bounded send could otherwise strand the worker forever.
        let (event_tx, event_rx) = async_channel::unbounded();
        let (stop_tx, stop_rx) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("nerve-gpui-protocol".to_string())
            .spawn(move || run_worker(config, event_tx, stop_rx))
            .expect("protocol worker thread must start");
        (
            Self {
                stop: stop_tx,
                thread: Some(thread),
            },
            event_rx,
        )
    }
}

impl Drop for WorkerHandle {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        // Never block the GPUI thread waiting for a socket close. The worker has
        // short read timeouts and exits promptly after observing the signal.
        let _ = self.thread.take();
    }
}

fn run_worker(
    config: ConnectionConfig,
    events: EventSender<WorkerEvent>,
    stop: mpsc::Receiver<()>,
) {
    let target = config.display_target();
    let mut attempt = 0usize;
    loop {
        if should_stop(&stop) {
            let _ = events.send_blocking(WorkerEvent::Closed);
            return;
        }
        let status = if attempt == 0 {
            WorkerEvent::Connecting {
                target: target.clone(),
            }
        } else {
            WorkerEvent::Retrying {
                target: target.clone(),
                message: "Connection lost; retrying".to_string(),
            }
        };
        if events.send_blocking(status).is_err() {
            return;
        }

        match run_session(&config, &events, &stop) {
            Ok(()) => {
                let _ = events.send_blocking(WorkerEvent::Closed);
                return;
            }
            Err(error) if !should_stop(&stop) => {
                let message = public_error(&error);
                let _ = events.send_blocking(WorkerEvent::Error {
                    target: target.clone(),
                    message: message.clone(),
                });
                let delay = RETRY_DELAYS[attempt.min(RETRY_DELAYS.len() - 1)];
                attempt = attempt.saturating_add(1);
                let _ = events.send_blocking(WorkerEvent::Retrying {
                    target: target.clone(),
                    message,
                });
                if stop.recv_timeout(delay).is_ok() {
                    let _ = events.send_blocking(WorkerEvent::Closed);
                    return;
                }
            }
            Err(_) => {
                let _ = events.send_blocking(WorkerEvent::Closed);
                return;
            }
        }
    }
}

fn run_session(
    config: &ConnectionConfig,
    events: &EventSender<WorkerEvent>,
    stop: &mpsc::Receiver<()>,
) -> Result<(), String> {
    let client_config = fetch_client_config(config)?;
    let ws_url = Url::parse(&client_config.ws_url)
        .map_err(|error| format!("Server advertised an invalid WebSocket URL: {error}"))?;
    if !matches!(ws_url.scheme(), "ws" | "wss") {
        return Err("Server advertised a non-WebSocket URL".to_string());
    }

    let mut request = ws_url
        .as_str()
        .into_client_request()
        .map_err(|error| format!("Could not create WebSocket request: {error}"))?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {}", config.token))
            .map_err(|_| "Daemon authentication metadata is invalid".to_string())?,
    );
    let mut socket = connect_websocket(request, &ws_url)?;
    set_socket_timeout(socket.get_mut(), IO_POLL_INTERVAL)?;

    let mut session = ProtocolSession::new();
    session.send_hello(&mut socket)?;
    let welcome = session.receive_welcome(&mut socket, stop)?;
    session.send_ready(&mut socket)?;

    // Workspace snapshots can exceed the WebSocket codec's 1 MiB frame cap.
    // The canonical HTTP protocol endpoint supports the same operation without
    // forcing a large response through the live event transport.
    let snapshot = fetch_workspace_snapshot(config, &session.source, &session.target)?;
    let user_home = client_config.status.storage.user_home;
    events
        .send_blocking(WorkerEvent::Snapshot {
            user_home: user_home.clone(),
            snapshot: snapshot.clone(),
        })
        .map_err(|_| "UI closed".to_string())?;
    session.subscribe_workspace(&mut socket, &snapshot, stop)?;
    events
        .send_blocking(WorkerEvent::Live {
            target: config.display_target(),
        })
        .map_err(|_| "UI closed".to_string())?;

    loop {
        if should_stop(stop) {
            let _ = session.send_goodbye(&mut socket);
            let _ = socket.close(None);
            return Ok(());
        }
        session.ensure_alive()?;
        if session.heartbeat_due(welcome.heartbeat.interval_ms) {
            session.send_heartbeat(&mut socket)?;
        }
        let Some(envelope) = read_envelope(&mut socket)? else {
            continue;
        };
        session.validate_server_envelope(&envelope)?;
        match envelope.kind.as_str() {
            "heartbeat" => session.send_heartbeat(&mut socket)?,
            "event.batch" => {
                if session.apply_workspace_batch(&envelope)? {
                    let snapshot =
                        fetch_workspace_snapshot(config, &session.source, &session.target)?;
                    events
                        .send_blocking(WorkerEvent::Snapshot {
                            user_home: user_home.clone(),
                            snapshot,
                        })
                        .map_err(|_| "UI closed".to_string())?;
                    // Keep the existing live subscription. Replacing it after
                    // every event races queued live batches against replay and
                    // can deliver the same sequence twice.
                }
            }
            "goodbye" => return Err(server_message(&envelope, "Server closed the session")),
            "error" => return Err(server_message(&envelope, "Protocol error")),
            "event.notify" => {}
            _ => {}
        }
    }
}

fn http_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(REQUEST_TIMEOUT))
        .build()
        .into()
}

fn fetch_client_config(config: &ConnectionConfig) -> Result<ClientConfigResponse, String> {
    let mut response = http_agent()
        .get(config.client_config_url().as_str())
        .header("authorization", &format!("Bearer {}", config.token))
        .call()
        .map_err(|error| format!("Could not load Workbench client configuration: {error}"))?;
    response
        .body_mut()
        .read_json::<ClientConfigResponse>()
        .map_err(|error| format!("Workbench client configuration is invalid: {error}"))
}

fn fetch_workspace_snapshot(
    config: &ConnectionConfig,
    source: &PeerDescriptor,
    target: &PeerDescriptor,
) -> Result<WorkspaceSnapshotResponse, String> {
    let request = outgoing_envelope(
        "request",
        json!({ "method": "snapshot.workspace.get", "params": {} }),
        source.clone(),
        target.clone(),
    );
    let request_id = request.id.clone();
    let mut response = http_agent()
        .post(config.protocol_url().as_str())
        .header("authorization", &format!("Bearer {}", config.token))
        .header("content-type", "application/vnd.nerve.protocol.v1+json")
        .send_json(&request)
        .map_err(|error| format!("Could not load Workbench workspace snapshot: {error}"))?;
    let envelope = response
        .body_mut()
        .read_json::<Envelope>()
        .map_err(|error| format!("Workbench workspace snapshot response is invalid: {error}"))?;
    if envelope.protocol != "nerve"
        || envelope.version != 1
        || envelope.source != *target
        // HTTP protocol responses are intentionally addressed to the generic
        // UI role rather than echoing the request's concrete peer identity.
        || envelope.target != PeerDescriptor::http_response_target()
        || envelope.reply_to.as_deref() != Some(request_id.as_str())
    {
        return Err("Workspace snapshot response identity does not match the request".to_string());
    }
    if envelope.kind == "error" {
        return Err(server_message(
            &envelope,
            "Workspace snapshot request failed",
        ));
    }
    if envelope.kind != "response"
        || envelope.data.get("method").and_then(Value::as_str) != Some("snapshot.workspace.get")
        || envelope.data.get("ok").and_then(Value::as_bool) != Some(true)
    {
        return Err("Workspace snapshot response does not match the request".to_string());
    }
    let result = envelope
        .data
        .get("result")
        .cloned()
        .ok_or_else(|| "Workspace snapshot response has no result".to_string())?;
    serde_json::from_value(result)
        .map_err(|error| format!("Workspace snapshot is invalid: {error}"))
}

fn should_stop(stop: &mpsc::Receiver<()>) -> bool {
    match stop.try_recv() {
        Ok(()) | Err(mpsc::TryRecvError::Disconnected) => true,
        Err(mpsc::TryRecvError::Empty) => false,
    }
}

fn connect_websocket(
    request: tungstenite::handshake::client::Request,
    ws_url: &Url,
) -> Result<Socket, String> {
    let host = ws_url
        .host_str()
        .ok_or_else(|| "WebSocket URL has no host".to_string())?;
    let port = ws_url
        .port_or_known_default()
        .ok_or_else(|| "WebSocket URL has no port".to_string())?;
    let addresses = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Could not resolve Workbench server: {error}"))?;
    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) {
            Ok(stream) => {
                stream
                    .set_read_timeout(Some(REQUEST_TIMEOUT))
                    .map_err(|error| format!("Could not configure WebSocket: {error}"))?;
                stream
                    .set_write_timeout(Some(REQUEST_TIMEOUT))
                    .map_err(|error| format!("Could not configure WebSocket: {error}"))?;
                return tungstenite::client_tls_with_config(request.clone(), stream, None, None)
                    .map(|(socket, _)| socket)
                    .map_err(|error| format!("Could not connect to Workbench WebSocket: {error}"));
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(format!(
        "Could not connect to Workbench WebSocket: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "server address was unavailable".to_string())
    ))
}

fn set_socket_timeout(
    stream: &mut MaybeTlsStream<TcpStream>,
    timeout: Duration,
) -> Result<(), String> {
    let result = match stream {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(Some(timeout)),
        MaybeTlsStream::Rustls(stream) => stream.sock.set_read_timeout(Some(timeout)),
        _ => return Err("Unsupported WebSocket transport".to_string()),
    };
    result.map_err(|error| format!("Could not configure WebSocket: {error}"))
}

fn public_error(error: &str) -> String {
    let line = error.lines().next().unwrap_or("Connection failed");
    line.chars().take(240).collect()
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
struct PeerDescriptor {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(rename = "instanceId", skip_serializing_if = "Option::is_none")]
    instance_id: Option<String>,
}

impl PeerDescriptor {
    fn ui(client_id: String, instance_id: String) -> Self {
        Self {
            role: "ui".to_string(),
            id: Some(client_id),
            name: Some("Nerve GPUI Workbench".to_string()),
            instance_id: Some(instance_id),
        }
    }

    fn server() -> Self {
        Self {
            role: "workbench_server".to_string(),
            id: None,
            name: None,
            instance_id: None,
        }
    }

    fn http_response_target() -> Self {
        Self {
            role: "ui".to_string(),
            id: None,
            name: None,
            instance_id: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct Envelope {
    protocol: String,
    version: u8,
    id: String,
    kind: String,
    ts: String,
    source: PeerDescriptor,
    target: PeerDescriptor,
    #[serde(rename = "correlationId", skip_serializing_if = "Option::is_none")]
    correlation_id: Option<String>,
    #[serde(rename = "replyTo", skip_serializing_if = "Option::is_none")]
    reply_to: Option<String>,
    data: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WelcomeData {
    session_id: String,
    accepting_peer: PeerDescriptor,
    accepted_version: u8,
    capabilities: Vec<String>,
    encoding: String,
    heartbeat: HeartbeatConfig,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeartbeatConfig {
    interval_ms: u64,
    timeout_ms: u64,
}

struct ProtocolSession {
    source: PeerDescriptor,
    target: PeerDescriptor,
    session_id: Option<String>,
    last_sent_at: Instant,
    last_received_at: Instant,
    heartbeat_timeout: Duration,
    workspace_seq: u64,
}

impl ProtocolSession {
    fn new() -> Self {
        Self {
            source: PeerDescriptor::ui(
                format!("gpui_{}", Uuid::new_v4()),
                format!("instance_{}", Uuid::new_v4()),
            ),
            target: PeerDescriptor::server(),
            session_id: None,
            last_sent_at: Instant::now(),
            last_received_at: Instant::now(),
            heartbeat_timeout: HANDSHAKE_TIMEOUT,
            workspace_seq: 0,
        }
    }

    fn send_hello(&mut self, socket: &mut Socket) -> Result<(), String> {
        self.send(
            socket,
            "hello",
            json!({
                "requestedVersion": 1,
                "capabilities": REQUIRED_CAPABILITIES,
                "requiredCapabilities": REQUIRED_CAPABILITIES,
                "encodings": ["json"]
            }),
        )?;
        Ok(())
    }

    fn receive_welcome(
        &mut self,
        socket: &mut Socket,
        stop: &mpsc::Receiver<()>,
    ) -> Result<WelcomeData, String> {
        let envelope = self.read_until(socket, stop, |message| message.kind == "welcome")?;
        if envelope.protocol != "nerve" || envelope.version != 1 {
            return Err("Server selected an unsupported protocol version".to_string());
        }
        if envelope.target != self.source {
            return Err("Welcome message was addressed to another client".to_string());
        }
        let welcome: WelcomeData = serde_json::from_value(envelope.data)
            .map_err(|error| format!("Welcome message is invalid: {error}"))?;
        if welcome.accepted_version != 1 || welcome.encoding != "json" {
            return Err("Server did not negotiate protocol v1 JSON".to_string());
        }
        if envelope.source != welcome.accepting_peer
            || welcome.accepting_peer.role != "workbench_server"
        {
            return Err("Welcome message server identity is invalid".to_string());
        }
        let accepted: HashSet<&str> = welcome.capabilities.iter().map(String::as_str).collect();
        let missing: Vec<_> = REQUIRED_CAPABILITIES
            .iter()
            .copied()
            .filter(|capability| !accepted.contains(capability))
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "Server is missing required capabilities: {}",
                missing.join(", ")
            ));
        }
        if welcome.heartbeat.interval_ms == 0 || welcome.heartbeat.timeout_ms == 0 {
            return Err("Server supplied invalid heartbeat settings".to_string());
        }
        self.target = welcome.accepting_peer.clone();
        self.session_id = Some(welcome.session_id.clone());
        self.last_received_at = Instant::now();
        self.heartbeat_timeout = Duration::from_millis(welcome.heartbeat.timeout_ms);
        Ok(welcome)
    }

    fn send_ready(&mut self, socket: &mut Socket) -> Result<(), String> {
        self.send(socket, "ready", json!({ "sessionId": self.session_id()? }))?;
        Ok(())
    }

    fn subscribe_workspace(
        &mut self,
        socket: &mut Socket,
        snapshot: &WorkspaceSnapshotResponse,
        stop: &mpsc::Receiver<()>,
    ) -> Result<(), String> {
        let cursor = workspace_cursor(snapshot)
            .ok_or_else(|| "Workspace snapshot did not include a workspace cursor".to_string())?;
        self.workspace_seq = cursor.processed_seq;
        let subscription_id = format!("sub_{}", Uuid::new_v4());
        self.send(
            socket,
            "stream.subscription.set",
            json!({
                "sessionId": self.session_id()?,
                "subscriptionId": subscription_id,
                "streams": [cursor]
            }),
        )?;
        let envelope = self.read_until(socket, stop, |message| {
            message.kind == "stream.subscription.updated"
                && message.data.get("subscriptionId").and_then(Value::as_str)
                    == Some(subscription_id.as_str())
        })?;
        if envelope.data.get("sessionId").and_then(Value::as_str) != Some(self.session_id()?) {
            return Err("Workspace subscription session does not match".to_string());
        }
        if envelope.data.get("accepted").and_then(Value::as_bool) != Some(true) {
            return Err(server_message(
                &envelope,
                "Workspace subscription was rejected",
            ));
        }
        let mode = envelope
            .data
            .get("streams")
            .and_then(Value::as_array)
            .and_then(|streams| {
                streams.iter().find(|stream| {
                    stream.get("stream").and_then(Value::as_str) == Some("workspace")
                })
            })
            .and_then(|stream| stream.get("mode"))
            .and_then(Value::as_str)
            .ok_or_else(|| "Workspace subscription response is incomplete".to_string())?;
        match mode {
            "live" | "replay" => Ok(()),
            "snapshot_required" => {
                Err("Workspace subscription requires a fresh snapshot".to_string())
            }
            "unavailable" => Err("Workspace event stream is unavailable".to_string()),
            _ => Err("Workspace subscription mode is invalid".to_string()),
        }
    }

    fn apply_workspace_batch(&mut self, envelope: &Envelope) -> Result<bool, String> {
        if envelope.data.get("stream").and_then(Value::as_str) != Some("workspace") {
            return Ok(false);
        }
        let events = envelope
            .data
            .get("events")
            .and_then(Value::as_array)
            .ok_or_else(|| "Workspace event batch is invalid".to_string())?;
        if events.is_empty() {
            return Ok(false);
        }
        let first = events[0]
            .get("seq")
            .and_then(Value::as_u64)
            .ok_or_else(|| "Workspace event sequence is invalid".to_string())?;
        if first != self.workspace_seq.saturating_add(1) {
            return Err(format!(
                "Workspace event gap: expected {}, received {first}",
                self.workspace_seq.saturating_add(1)
            ));
        }
        for (offset, event) in events.iter().enumerate() {
            let sequence = event
                .get("seq")
                .and_then(Value::as_u64)
                .ok_or_else(|| "Workspace event sequence is invalid".to_string())?;
            if sequence != first + offset as u64 {
                return Err("Workspace event batch is not consecutive".to_string());
            }
        }
        self.workspace_seq = first + events.len() as u64 - 1;
        Ok(true)
    }

    fn validate_server_envelope(&mut self, envelope: &Envelope) -> Result<(), String> {
        if envelope.protocol != "nerve" || envelope.version != 1 {
            return Err("Received an unsupported protocol message".to_string());
        }
        if envelope.source != self.target || envelope.target != self.source {
            return Err("Received a protocol message for another peer".to_string());
        }
        self.last_received_at = Instant::now();
        Ok(())
    }

    fn read_until(
        &mut self,
        socket: &mut Socket,
        stop: &mpsc::Receiver<()>,
        predicate: impl Fn(&Envelope) -> bool,
    ) -> Result<Envelope, String> {
        loop {
            if should_stop(stop) {
                return Err("Client is closing".to_string());
            }
            self.ensure_alive()?;
            let Some(envelope) = read_envelope(socket)? else {
                continue;
            };
            if self.session_id.is_some() {
                self.validate_server_envelope(&envelope)?;
            }
            if envelope.kind == "error" {
                if predicate(&envelope) {
                    return Ok(envelope);
                }
                return Err(server_message(&envelope, "Protocol error"));
            }
            if envelope.kind == "goodbye" {
                return Err(server_message(&envelope, "Server closed the session"));
            }
            if envelope.kind == "heartbeat" && self.session_id.is_some() {
                self.send_heartbeat(socket)?;
                continue;
            }
            if envelope.kind == "event.batch" && self.session_id.is_some() {
                self.apply_workspace_batch(&envelope)?;
                continue;
            }
            if predicate(&envelope) {
                return Ok(envelope);
            }
        }
    }

    fn heartbeat_due(&self, interval_ms: u64) -> bool {
        self.last_sent_at.elapsed() >= Duration::from_millis(interval_ms)
    }

    fn ensure_alive(&self) -> Result<(), String> {
        if self.last_received_at.elapsed() > self.heartbeat_timeout {
            return Err("Protocol heartbeat timed out".to_string());
        }
        Ok(())
    }

    fn send_heartbeat(&mut self, socket: &mut Socket) -> Result<(), String> {
        self.send(
            socket,
            "heartbeat",
            json!({
                "sessionId": self.session_id()?,
                "sentAt": timestamp()
            }),
        )?;
        Ok(())
    }

    fn send_goodbye(&mut self, socket: &mut Socket) -> Result<(), String> {
        let Some(session_id) = self.session_id.clone() else {
            return Ok(());
        };
        self.send(
            socket,
            "goodbye",
            json!({ "sessionId": session_id, "reason": "client_closing" }),
        )?;
        Ok(())
    }

    fn send(&mut self, socket: &mut Socket, kind: &str, data: Value) -> Result<String, String> {
        let envelope = outgoing_envelope(kind, data, self.source.clone(), self.target.clone());
        let id = envelope.id.clone();
        let text = serde_json::to_string(&envelope)
            .map_err(|error| format!("Could not encode protocol message: {error}"))?;
        socket
            .send(Message::Text(text.into()))
            .map_err(|error| format!("Could not send protocol message: {error}"))?;
        self.last_sent_at = Instant::now();
        Ok(id)
    }

    fn session_id(&self) -> Result<&str, String> {
        self.session_id
            .as_deref()
            .ok_or_else(|| "Protocol session is not ready".to_string())
    }
}

type Socket = WebSocket<MaybeTlsStream<TcpStream>>;

fn outgoing_envelope(
    kind: &str,
    data: Value,
    source: PeerDescriptor,
    target: PeerDescriptor,
) -> Envelope {
    Envelope {
        protocol: "nerve".to_string(),
        version: 1,
        id: format!("msg_{}", Uuid::new_v4()),
        kind: kind.to_string(),
        ts: timestamp(),
        source,
        target,
        correlation_id: None,
        reply_to: None,
        data,
    }
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn read_envelope(socket: &mut Socket) -> Result<Option<Envelope>, String> {
    match socket.read() {
        Ok(Message::Text(text)) => serde_json::from_str::<Envelope>(&text)
            .map(Some)
            .map_err(|error| format!("Received an invalid protocol message: {error}")),
        Ok(Message::Binary(_)) => {
            Err("Server sent an unsupported binary protocol message".to_string())
        }
        Ok(Message::Ping(payload)) => {
            socket
                .send(Message::Pong(payload))
                .map_err(|error| format!("Could not answer WebSocket ping: {error}"))?;
            Ok(None)
        }
        Ok(Message::Pong(_)) | Ok(Message::Frame(_)) => Ok(None),
        Ok(Message::Close(frame)) => Err(frame
            .map(|frame| format!("WebSocket closed: {}", frame.reason))
            .unwrap_or_else(|| "WebSocket closed".to_string())),
        Err(tungstenite::Error::Io(error)) if is_timeout(&error) => Ok(None),
        Err(error) => Err(format!("Could not read Workbench WebSocket: {error}")),
    }
}

fn is_timeout(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
    )
}

fn workspace_cursor(snapshot: &WorkspaceSnapshotResponse) -> Option<&StreamCursor> {
    snapshot
        .cursor
        .streams
        .iter()
        .find(|cursor| cursor.stream == "workspace")
}

fn server_message(envelope: &Envelope, fallback: &str) -> String {
    envelope
        .data
        .get("message")
        .and_then(Value::as_str)
        .map(public_error)
        .unwrap_or_else(|| fallback.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };

    use tungstenite::handshake::server::{Request, Response};

    use super::*;

    fn peer(role: &str, id: &str) -> PeerDescriptor {
        PeerDescriptor {
            role: role.to_string(),
            id: Some(id.to_string()),
            name: None,
            instance_id: None,
        }
    }

    fn receive_text(socket: &mut WebSocket<TcpStream>) -> Envelope {
        let Message::Text(text) = socket.read().unwrap() else {
            panic!("expected text protocol message");
        };
        serde_json::from_str(&text).unwrap()
    }

    fn send_server(
        socket: &mut WebSocket<TcpStream>,
        kind: &str,
        data: Value,
        source: &PeerDescriptor,
        target: &PeerDescriptor,
        reply_to: Option<String>,
    ) {
        let mut envelope = outgoing_envelope(kind, data, source.clone(), target.clone());
        envelope.reply_to = reply_to.clone();
        envelope.correlation_id = reply_to;
        socket
            .send(Message::Text(
                serde_json::to_string(&envelope).unwrap().into(),
            ))
            .unwrap();
    }

    fn receive_http_request(stream: &mut TcpStream) -> (String, Vec<u8>) {
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 4096];
        let header_end = loop {
            let read = stream.read(&mut buffer).unwrap();
            assert!(read > 0, "HTTP request ended before its headers");
            bytes.extend_from_slice(&buffer[..read]);
            if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                break index + 4;
            }
        };
        let headers = String::from_utf8_lossy(&bytes[..header_end]).to_string();
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().unwrap())
            })
            .unwrap_or_default();
        while bytes.len() < header_end + content_length {
            let read = stream.read(&mut buffer).unwrap();
            assert!(read > 0, "HTTP request ended before its body");
            bytes.extend_from_slice(&buffer[..read]);
        }
        (
            headers,
            bytes[header_end..header_end + content_length].to_vec(),
        )
    }

    fn send_http_json(stream: &mut TcpStream, body: &str) {
        write!(
            stream,
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
        stream.flush().unwrap();
    }

    fn workspace_response(request: Envelope, title: &str, sequence: u64, padding: usize) -> String {
        assert_eq!(request.kind, "request");
        assert_eq!(
            request.data.get("method").and_then(Value::as_str),
            Some("snapshot.workspace.get")
        );
        let mut response = outgoing_envelope(
            "response",
            json!({
                "ok": true,
                "method": "snapshot.workspace.get",
                "result": {
                    "snapshot": {
                        "projects": [{
                            "id": "proj_test",
                            "name": "test",
                            "dir": "/work/test",
                            "createdAt": "2026-09-01T00:00:00Z",
                            "updatedAt": "2026-09-04T00:00:00Z"
                        }],
                        "conversations": [{
                            "id": "conv_test",
                            "projectId": "proj_test",
                            "title": title,
                            "createdAt": "2026-09-04T00:00:00Z",
                            "updatedAt": "2026-09-04T00:00:00Z"
                        }],
                        "agents": [{"ignoredPadding": "x".repeat(padding)}],
                        "tasks": [],
                        "pendingToolCalls": []
                    },
                    "cursor": {
                        "streams": [{"stream": "workspace", "processedSeq": sequence}]
                    },
                    "generatedAt": "2026-09-04T00:00:00Z"
                }
            }),
            peer("workbench_server", "server"),
            PeerDescriptor::http_response_target(),
        );
        response.reply_to = Some(request.id.clone());
        response.correlation_id = Some(request.id);
        serde_json::to_string(&response).unwrap()
    }

    #[test]
    #[allow(clippy::result_large_err)]
    fn worker_authenticates_handshakes_and_loads_large_snapshot_over_http() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut config_http, _) = listener.accept().unwrap();
            let (headers, body) = receive_http_request(&mut config_http);
            assert!(
                headers
                    .to_lowercase()
                    .contains("authorization: bearer nt_test")
            );
            assert!(body.is_empty());
            let config_body = format!(
                r#"{{"wsUrl":"ws://{address}/ws","status":{{"storage":{{"userHome":"/home/test"}}}}}}"#
            );
            send_http_json(&mut config_http, &config_body);
            drop(config_http);

            let (stream, _) = listener.accept().unwrap();
            let websocket_server = thread::spawn(move || {
                let mut socket =
                    tungstenite::accept_hdr(stream, |request: &Request, response: Response| {
                        assert_eq!(
                            request.headers().get("authorization").unwrap(),
                            "Bearer nt_test"
                        );
                        Ok(response)
                    })
                    .unwrap();
                let hello = receive_text(&mut socket);
                assert_eq!(hello.kind, "hello");
                let server_peer = peer("workbench_server", "server");
                send_server(
                    &mut socket,
                    "welcome",
                    json!({
                        "sessionId": "ses_test",
                        "acceptingPeer": server_peer,
                        "acceptedVersion": 1,
                        "capabilities": REQUIRED_CAPABILITIES,
                        "encoding": "json",
                        "limits": {
                            "maxMessageBytes": 1048576,
                            "maxBatchEvents": 500,
                            "maxBatchBytes": 1048576
                        },
                        "heartbeat": {"intervalMs": 30000, "timeoutMs": 70000}
                    }),
                    &server_peer,
                    &hello.source,
                    None,
                );
                assert_eq!(receive_text(&mut socket).kind, "ready");
                let subscription = receive_text(&mut socket);
                assert_eq!(subscription.kind, "stream.subscription.set");
                let subscription_id = subscription
                    .data
                    .get("subscriptionId")
                    .and_then(Value::as_str)
                    .unwrap()
                    .to_string();
                send_server(
                    &mut socket,
                    "stream.subscription.updated",
                    json!({
                        "sessionId": "ses_test",
                        "subscriptionId": subscription_id,
                        "accepted": true,
                        "streams": [{
                            "stream": "workspace",
                            "latestSeq": 3,
                            "earliestAvailableSeq": 1,
                            "mode": "live"
                        }]
                    }),
                    &server_peer,
                    &hello.source,
                    None,
                );
                send_server(
                    &mut socket,
                    "event.batch",
                    json!({
                        "sessionId": "ses_test",
                        "subscriptionId": subscription_id,
                        "stream": "workspace",
                        "events": [{"seq": 4}]
                    }),
                    &server_peer,
                    &hello.source,
                    None,
                );
                let closing = receive_text(&mut socket);
                assert_eq!(closing.kind, "goodbye");
            });

            let (mut snapshot_http, _) = listener.accept().unwrap();
            let (headers, body) = receive_http_request(&mut snapshot_http);
            let headers = headers.to_lowercase();
            assert!(headers.contains("authorization: bearer nt_test"));
            assert!(headers.contains("content-type: application/vnd.nerve.protocol.v1+json"));
            let request: Envelope = serde_json::from_slice(&body).unwrap();
            let response_body = workspace_response(request, "Connected", 3, 1_100_000);
            assert!(response_body.len() > 1_048_576);
            send_http_json(&mut snapshot_http, &response_body);

            let (mut refresh_http, _) = listener.accept().unwrap();
            let (headers, body) = receive_http_request(&mut refresh_http);
            assert!(
                headers
                    .to_lowercase()
                    .contains("authorization: bearer nt_test")
            );
            let request: Envelope = serde_json::from_slice(&body).unwrap();
            let response_body = workspace_response(request, "Refreshed", 4, 0);
            send_http_json(&mut refresh_http, &response_body);
            websocket_server.join().unwrap();
        });

        let config = ConnectionConfig {
            target: Url::parse(&format!("http://{address}")).unwrap(),
            token: "nt_test".to_string(),
        };
        let (worker, events) = WorkerHandle::spawn(config);
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut saw_large_snapshot = false;
        let mut saw_refreshed_snapshot = false;
        let mut saw_live = false;
        while Instant::now() < deadline && !(saw_live && saw_refreshed_snapshot) {
            match events.try_recv() {
                Ok(WorkerEvent::Snapshot { snapshot, .. }) => {
                    let title = &snapshot.snapshot.conversations[0].title;
                    saw_large_snapshot |= title == "Connected";
                    saw_refreshed_snapshot |= title == "Refreshed";
                }
                Ok(WorkerEvent::Live { .. }) => saw_live = true,
                Ok(WorkerEvent::Error { message, .. }) => panic!("worker failed: {message}"),
                Ok(_) | Err(async_channel::TryRecvError::Empty) => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(async_channel::TryRecvError::Closed) => break,
            }
        }
        assert!(saw_large_snapshot);
        assert!(saw_refreshed_snapshot);
        assert!(saw_live);
        drop(worker);
        server.join().unwrap();
    }

    #[test]
    fn hello_envelope_has_protocol_identity_without_credentials() {
        let source = peer("ui", "client");
        let envelope = outgoing_envelope(
            "hello",
            json!({
                "requestedVersion": 1,
                "capabilities": REQUIRED_CAPABILITIES,
                "requiredCapabilities": REQUIRED_CAPABILITIES,
                "encodings": ["json"]
            }),
            source,
            PeerDescriptor::server(),
        );
        let encoded = serde_json::to_string(&envelope).unwrap();
        assert!(encoded.contains("\"protocol\":\"nerve\""));
        assert!(encoded.contains("operation.snapshot.workspace.get"));
        assert!(!encoded.contains("authorization"));
        assert!(!encoded.contains("token"));
    }

    #[test]
    fn workspace_batches_require_consecutive_sequences() {
        let mut session = ProtocolSession::new();
        session.workspace_seq = 7;
        session.target = peer("workbench_server", "server");
        let valid = Envelope {
            protocol: "nerve".to_string(),
            version: 1,
            id: "msg_batch".to_string(),
            kind: "event.batch".to_string(),
            ts: timestamp(),
            source: session.target.clone(),
            target: session.source.clone(),
            correlation_id: None,
            reply_to: None,
            data: json!({
                "stream": "workspace",
                "events": [{"seq": 8}, {"seq": 9}]
            }),
        };
        assert!(session.apply_workspace_batch(&valid).unwrap());
        assert_eq!(session.workspace_seq, 9);

        let gap = Envelope {
            data: json!({"stream": "workspace", "events": [{"seq": 11}]}),
            ..valid
        };
        assert!(session.apply_workspace_batch(&gap).is_err());
    }

    #[test]
    fn public_errors_are_bounded_to_one_line() {
        let error = format!("{}\nsecret detail", "x".repeat(300));
        let public = public_error(&error);
        assert_eq!(public.chars().count(), 240);
        assert!(!public.contains("secret detail"));
    }
}
