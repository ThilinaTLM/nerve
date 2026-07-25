use std::collections::{BTreeMap, HashSet};
use std::thread;
use std::time::Duration;

use anyhow::{Context as _, Result, bail};
use futures_util::{SinkExt as _, StreamExt as _};
use serde::Deserialize;
use serde_json::Value;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{Message, client::IntoClientRequest as _},
};

use crate::daemon::DaemonConnection;
use crate::state::{
    conversation::ConversationState,
    workspace::{Conversation, WorkspaceState},
};

use super::{
    envelope::{Envelope, PeerDescriptor, PeerRole},
    messages::{
        CAPABILITIES, EventBatchData, HelloData, ReadyData, RequestData, StreamCursor,
        SubscriptionSetData, SubscriptionUpdatedData, WelcomeData, WireMessage,
    },
};

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Debug, Clone)]
pub(crate) enum ProtocolCommand {
    SelectConversation(String),
    StartDraft { project_id: String, text: String },
    SendPrompt { text: String },
    Shutdown,
}

#[derive(Debug, Clone)]
pub(crate) enum ProtocolEvent {
    Connecting,
    Connected,
    Disconnected(String),
    Workspace(WorkspaceState),
    Conversation(ConversationState),
    ConversationCreated { conversation_id: String },
    PromptAccepted,
    Error(String),
}

#[derive(Clone)]
pub(crate) struct ProtocolHandle {
    commands: mpsc::UnboundedSender<ProtocolCommand>,
    events: async_channel::Receiver<ProtocolEvent>,
}

impl ProtocolHandle {
    pub(crate) fn start(connection: DaemonConnection) -> Self {
        let (commands, command_rx) = mpsc::unbounded_channel();
        let (event_tx, events) = async_channel::unbounded();
        thread::Builder::new()
            .name("nerve-native-protocol".into())
            .spawn(move || {
                let runtime = tokio::runtime::Runtime::new()
                    .expect("failed to create native protocol runtime");
                runtime.block_on(run_worker(connection, command_rx, event_tx));
            })
            .expect("failed to start native protocol worker");
        Self { commands, events }
    }

    pub(crate) fn send(&self, command: ProtocolCommand) -> Result<()> {
        self.commands
            .send(command)
            .map_err(|_| anyhow::anyhow!("protocol worker is not running"))
    }

    pub(crate) fn events(&self) -> async_channel::Receiver<ProtocolEvent> {
        self.events.clone()
    }
}

impl Drop for ProtocolHandle {
    fn drop(&mut self) {
        if self.commands.strong_count() == 1 {
            let _ = self.commands.send(ProtocolCommand::Shutdown);
        }
    }
}

async fn run_worker(
    connection: DaemonConnection,
    mut commands: mpsc::UnboundedReceiver<ProtocolCommand>,
    events: async_channel::Sender<ProtocolEvent>,
) {
    let mut selected_id = None;
    let delays = [250, 500, 1_000, 2_000, 5_000];
    let mut attempt = 0usize;
    loop {
        let _ = events.send(ProtocolEvent::Connecting).await;
        match Session::connect(connection.clone(), events.clone(), selected_id.as_deref()).await {
            Ok(mut session) => {
                attempt = 0;
                let _ = events.send(ProtocolEvent::Connected).await;
                let result = session.run(&mut commands).await;
                selected_id.clone_from(&session.selected_id);
                match result {
                    Ok(()) => return,
                    Err(error) => {
                        let _ = events
                            .send(ProtocolEvent::Disconnected(format!("{error:#}")))
                            .await;
                    }
                }
            }
            Err(error) => {
                let _ = events
                    .send(ProtocolEvent::Disconnected(format!("{error:#}")))
                    .await;
            }
        }
        let delay = delays[attempt.min(delays.len() - 1)];
        attempt = attempt.saturating_add(1);
        tokio::select! {
            () = tokio::time::sleep(Duration::from_millis(delay)) => {}
            command = commands.recv() => {
                match command {
                    Some(ProtocolCommand::Shutdown) | None => return,
                    Some(ProtocolCommand::SelectConversation(id)) => selected_id = Some(id),
                    Some(other) => {
                        let _ = events.send(ProtocolEvent::Error(format!(
                            "Cannot send while disconnected; reconnect and retry ({other:?})"
                        ))).await;
                    }
                }
            }
        }
    }
}

#[allow(
    clippy::struct_field_names,
    reason = "session_id mirrors the Protocol v1 field and is clearer than an abbreviated name"
)]
struct Session {
    socket: Socket,
    peer: ClientPeer,
    session_id: String,
    cursors: BTreeMap<String, u64>,
    active_streams: HashSet<String>,
    workspace: WorkspaceState,
    conversation: Option<ConversationState>,
    selected_id: Option<String>,
    events: async_channel::Sender<ProtocolEvent>,
}

impl Session {
    async fn connect(
        connection: DaemonConnection,
        events: async_channel::Sender<ProtocolEvent>,
        selected_id: Option<&str>,
    ) -> Result<Self> {
        let mut request = connection.websocket_url.as_str().into_client_request()?;
        connection.authorize_websocket_request(&mut request)?;
        let (socket, _) = connect_async(request).await?;
        let mut session = Self {
            socket,
            peer: ClientPeer::new(),
            session_id: String::new(),
            cursors: BTreeMap::new(),
            active_streams: HashSet::new(),
            workspace: WorkspaceState::default(),
            conversation: None,
            selected_id: selected_id.map(ToOwned::to_owned),
            events,
        };
        session.negotiate().await?;
        session.load_workspace().await?;
        if let Some(id) = selected_id {
            session.load_conversation(id).await?;
        } else {
            session.subscribe().await?;
        }
        Ok(session)
    }

    async fn negotiate(&mut self) -> Result<()> {
        self.send(WireMessage::Hello {
            envelope: self.peer.envelope(),
            data: HelloData {
                requested_version: 1,
                capabilities: CAPABILITIES.iter().map(ToString::to_string).collect(),
                required_capabilities: Some(CAPABILITIES.iter().map(ToString::to_string).collect()),
                encodings: vec!["json".into()],
                preferences: None,
            },
        })
        .await?;
        let WireMessage::Welcome { data, .. } = next_wire_message(&mut self.socket).await? else {
            bail!("expected welcome as first daemon message");
        };
        for capability in CAPABILITIES {
            if !data.capabilities.iter().any(|value| value == capability) {
                bail!("server did not negotiate required capability {capability}");
            }
        }
        self.accept_welcome(data).await
    }

    async fn accept_welcome(&mut self, welcome: WelcomeData) -> Result<()> {
        self.session_id.clone_from(&welcome.session_id);
        self.peer.target = welcome.accepting_peer;
        self.send(WireMessage::Ready {
            envelope: self.peer.envelope(),
            data: ReadyData {
                session_id: self.session_id.clone(),
                status: Some("ready".into()),
            },
        })
        .await
    }

    async fn run(&mut self, commands: &mut mpsc::UnboundedReceiver<ProtocolCommand>) -> Result<()> {
        loop {
            tokio::select! {
                command = commands.recv() => {
                    match command {
                        Some(ProtocolCommand::Shutdown) | None => return Ok(()),
                        Some(command) => self.handle_command(command).await,
                    }
                }
                frame = self.socket.next() => {
                    let frame = frame.ok_or_else(|| anyhow::anyhow!("daemon closed the protocol connection"))??;
                    if let Some(message) = decode_frame(frame)? {
                        self.process_unsolicited(message).await?;
                    }
                }
            }
        }
    }

    async fn handle_command(&mut self, command: ProtocolCommand) {
        let result = match command {
            ProtocolCommand::SelectConversation(id) => self.load_conversation(&id).await,
            ProtocolCommand::StartDraft { project_id, text } => {
                self.start_draft(&project_id, &text).await
            }
            ProtocolCommand::SendPrompt { text } => self.send_prompt(&text).await,
            ProtocolCommand::Shutdown => Ok(()),
        };
        if let Err(error) = result {
            let _ = self
                .events
                .send(ProtocolEvent::Error(format!("{error:#}")))
                .await;
        }
    }

    async fn start_draft(&mut self, project_id: &str, text: &str) -> Result<()> {
        let result = self
            .request(
                "conversation.create",
                serde_json::json!({ "projectId": project_id }),
                true,
            )
            .await?;
        let response: ConversationResponse =
            serde_json::from_value(result).context("decode conversation.create response")?;
        let conversation_id = response.conversation.id.clone();
        self.workspace
            .upsert_conversation(response.conversation.clone());
        self.events
            .send(ProtocolEvent::Workspace(self.workspace.clone()))
            .await?;
        self.events
            .send(ProtocolEvent::ConversationCreated {
                conversation_id: conversation_id.clone(),
            })
            .await?;

        let result = self
            .request(
                "agent.create",
                serde_json::json!({
                    "projectId": project_id,
                    "conversationId": conversation_id,
                }),
                true,
            )
            .await?;
        let response: AgentResponse =
            serde_json::from_value(result).context("decode agent.create response")?;
        self.load_conversation(&response.agent.conversation_id)
            .await?;
        self.start_run(&response.agent.id, text).await
    }

    async fn send_prompt(&mut self, text: &str) -> Result<()> {
        let conversation = self
            .conversation
            .as_ref()
            .context("select a conversation before sending")?;
        if conversation.running {
            bail!("the current run is still active");
        }
        let agent_id = if let Some(id) = &conversation.active_agent_id {
            id.clone()
        } else {
            let project_id = self
                .workspace
                .conversations
                .iter()
                .find(|value| value.id == conversation.id)
                .map(|value| value.project_id.clone())
                .context("selected conversation is missing from the workspace")?;
            let result = self
                .request(
                    "agent.create",
                    serde_json::json!({
                        "projectId": project_id,
                        "conversationId": conversation.id,
                    }),
                    true,
                )
                .await?;
            let response: AgentResponse =
                serde_json::from_value(result).context("decode agent.create response")?;
            if let Some(state) = &mut self.conversation {
                state.active_agent_id = Some(response.agent.id.clone());
            }
            response.agent.id
        };
        self.start_run(&agent_id, text).await
    }

    async fn start_run(&mut self, agent_id: &str, text: &str) -> Result<()> {
        self.request(
            "run.start",
            serde_json::json!({ "agentId": agent_id, "text": text }),
            true,
        )
        .await?;
        if let Some(conversation) = &mut self.conversation {
            conversation.running = true;
            conversation.run_status = Some("Starting".into());
            self.events
                .send(ProtocolEvent::Conversation(conversation.clone()))
                .await?;
        }
        self.events.send(ProtocolEvent::PromptAccepted).await?;
        Ok(())
    }

    async fn load_workspace(&mut self) -> Result<()> {
        let result = self
            .request("snapshot.workspace.get", serde_json::json!({}), false)
            .await?;
        let (workspace, cursors) = WorkspaceState::from_snapshot_result(result)?;
        self.workspace = workspace;
        self.install_cursors(&cursors);
        self.events
            .send(ProtocolEvent::Workspace(self.workspace.clone()))
            .await?;
        Ok(())
    }

    async fn load_conversation(&mut self, conversation_id: &str) -> Result<()> {
        let result = self
            .request(
                "snapshot.conversation.get",
                serde_json::json!({ "conversationId": conversation_id }),
                false,
            )
            .await?;
        let (conversation, cursors) = ConversationState::from_snapshot_result(result)?;
        self.cursors.retain(|stream, _| {
            !stream.starts_with("conv/") || stream == &format!("conv/{conversation_id}")
        });
        self.install_cursors(&cursors);
        self.selected_id = Some(conversation_id.to_owned());
        self.conversation = Some(conversation.clone());
        self.subscribe().await?;
        self.events
            .send(ProtocolEvent::Conversation(conversation))
            .await?;
        Ok(())
    }

    fn install_cursors(&mut self, cursors: &[StreamCursor]) {
        for cursor in cursors {
            self.cursors
                .insert(cursor.stream.clone(), cursor.processed_seq);
        }
    }

    async fn subscribe(&mut self) -> Result<()> {
        let subscription_id = format!("sub_{}", uuid::Uuid::new_v4());
        let request = WireMessage::SubscriptionSet {
            envelope: self.peer.envelope(),
            data: SubscriptionSetData {
                session_id: self.session_id.clone(),
                subscription_id: subscription_id.clone(),
                streams: self
                    .cursors
                    .iter()
                    .map(|(stream, processed_seq)| StreamCursor {
                        stream: stream.clone(),
                        processed_seq: *processed_seq,
                    })
                    .collect(),
            },
        };
        self.send(request).await?;
        loop {
            let message = next_wire_message(&mut self.socket).await?;
            match message {
                WireMessage::SubscriptionUpdated { data, .. }
                    if data.subscription_id == subscription_id =>
                {
                    let recovery = self.accept_subscription(&data)?;
                    if recovery.is_empty() {
                        return Ok(());
                    }
                    for stream in recovery {
                        if stream == "workspace" {
                            self.load_workspace().await?;
                        } else if let Some(conversation_id) = stream.strip_prefix("conv/") {
                            let result = self
                                .request(
                                    "snapshot.conversation.get",
                                    serde_json::json!({ "conversationId": conversation_id }),
                                    false,
                                )
                                .await?;
                            let (conversation, cursors) =
                                ConversationState::from_snapshot_result(result)?;
                            self.install_cursors(&cursors);
                            self.conversation = Some(conversation.clone());
                            self.events
                                .send(ProtocolEvent::Conversation(conversation))
                                .await?;
                        }
                    }
                    return Box::pin(self.subscribe()).await;
                }
                other => self.process_unsolicited(other).await?,
            }
        }
    }

    fn accept_subscription(&mut self, update: &SubscriptionUpdatedData) -> Result<Vec<String>> {
        if !update.accepted {
            bail!("stream subscription was rejected");
        }
        self.active_streams.clear();
        let mut recovery = Vec::new();
        for stream in &update.streams {
            match stream.mode.as_str() {
                "live" | "replay" => {
                    self.active_streams.insert(stream.stream.clone());
                }
                "unavailable" => {
                    self.cursors.remove(&stream.stream);
                }
                "snapshot_required" => recovery.push(stream.stream.clone()),
                other => bail!("unknown subscription mode {other}"),
            }
        }
        Ok(recovery)
    }

    async fn request(&mut self, method: &str, params: Value, idempotent: bool) -> Result<Value> {
        let envelope = self.peer.envelope();
        let request_id = envelope.id.clone();
        self.send(WireMessage::Request {
            envelope,
            data: RequestData {
                method: method.into(),
                params: Some(params),
                idempotency_key: idempotent.then(|| format!("idem_{}", uuid::Uuid::new_v4())),
                timeout_ms: Some(30_000),
                expect: None,
            },
        })
        .await?;
        let response = tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let message = next_wire_message(&mut self.socket).await?;
                match &message {
                    WireMessage::Response { envelope, data }
                        if data.method == method && is_reply(envelope, &request_id) =>
                    {
                        return ReadOnlyProtocolClient::result_payload(message, method);
                    }
                    WireMessage::Error { envelope, data } if is_reply(envelope, &request_id) => {
                        bail!("protocol error {}: {}", data.code, data.message);
                    }
                    _ => self.process_unsolicited(message).await?,
                }
            }
        })
        .await
        .map_err(|_| anyhow::anyhow!("timed out waiting for {method}"))??;
        Ok(response)
    }

    async fn process_unsolicited(&mut self, message: WireMessage) -> Result<()> {
        match message {
            WireMessage::Heartbeat { data, .. } => {
                self.send(WireMessage::Heartbeat {
                    envelope: self.peer.envelope(),
                    data,
                })
                .await
            }
            WireMessage::EventBatch { data, .. } => self.apply_batch(&data).await,
            WireMessage::Error { data, .. } => {
                bail!("protocol error {}: {}", data.code, data.message)
            }
            WireMessage::Unknown => bail!("unknown Protocol v1 message kind"),
            _ => Ok(()),
        }
    }

    async fn apply_batch(&mut self, batch: &EventBatchData) -> Result<()> {
        if !self.active_streams.contains(&batch.stream) {
            bail!(
                "event batch arrived for unsubscribed stream {}",
                batch.stream
            );
        }
        let mut expected = self.cursors.get(&batch.stream).copied().unwrap_or(0) + 1;
        for event in &batch.events {
            if event.seq < expected {
                continue;
            }
            if event.seq != expected {
                bail!(
                    "event gap on {}: expected {expected}, received {}",
                    batch.stream,
                    event.seq
                );
            }
            if batch.stream == "workspace" {
                self.workspace
                    .apply_event(&event.event_type, &event.data, event.seq)?;
                self.events
                    .send(ProtocolEvent::Workspace(self.workspace.clone()))
                    .await?;
            } else if self
                .selected_id
                .as_ref()
                .is_some_and(|id| batch.stream == format!("conv/{id}"))
                && let Some(conversation) = &mut self.conversation
            {
                conversation.apply_event(&event.event_type, &event.data, event.seq)?;
                self.events
                    .send(ProtocolEvent::Conversation(conversation.clone()))
                    .await?;
            }
            self.cursors.insert(batch.stream.clone(), event.seq);
            expected += 1;
        }
        Ok(())
    }

    async fn send(&mut self, message: WireMessage) -> Result<()> {
        self.socket
            .send(Message::Text(
                ReadOnlyProtocolClient::encode(&message)?.into(),
            ))
            .await?;
        Ok(())
    }
}

fn is_reply(envelope: &Envelope, request_id: &str) -> bool {
    envelope.reply_to.as_deref() == Some(request_id)
        || envelope.correlation_id.as_deref() == Some(request_id)
}

#[derive(Debug)]
struct ClientPeer {
    source: PeerDescriptor,
    target: PeerDescriptor,
}

impl ClientPeer {
    fn new() -> Self {
        Self {
            source: PeerDescriptor {
                role: PeerRole::Ui,
                id: Some(format!("native_{}", uuid::Uuid::new_v4())),
                name: Some("Nerve Native".into()),
                instance_id: Some(uuid::Uuid::new_v4().to_string()),
            },
            target: PeerDescriptor {
                role: PeerRole::WorkbenchServer,
                id: None,
                name: None,
                instance_id: None,
            },
        }
    }

    fn envelope(&self) -> Envelope {
        let mut envelope = Envelope::ui(format!("msg_{}", uuid::Uuid::new_v4()));
        envelope.source = self.source.clone();
        envelope.target = self.target.clone();
        envelope
    }
}

#[derive(Deserialize)]
struct ConversationResponse {
    conversation: Conversation,
}

#[derive(Deserialize)]
struct AgentResponse {
    agent: AgentProjection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentProjection {
    id: String,
    conversation_id: String,
}

/// Small read-only facade retained for the CLI probe and wire conformance tests.
#[derive(Debug)]
pub(crate) struct ReadOnlyProtocolClient {
    connection: DaemonConnection,
}

impl ReadOnlyProtocolClient {
    pub(crate) fn new(connection: DaemonConnection) -> Self {
        Self { connection }
    }

    pub(crate) fn websocket_url(&self) -> &url::Url {
        &self.connection.websocket_url
    }

    pub(crate) async fn load_workspace_snapshot(&mut self) -> Result<Value> {
        let (events, _receiver) = async_channel::unbounded();
        let mut session = Session::connect(self.connection.clone(), events, None).await?;
        let value = session
            .request("snapshot.workspace.get", serde_json::json!({}), false)
            .await?;
        Ok(value)
    }

    pub(crate) fn decode(input: &str) -> Result<WireMessage> {
        let raw: Value = serde_json::from_str(input)?;
        if raw.get("protocol").and_then(Value::as_str) != Some("nerve")
            || raw.get("version").and_then(Value::as_u64) != Some(1)
        {
            bail!("unsupported protocol envelope");
        }
        let message: WireMessage = serde_json::from_value(raw)?;
        match &message {
            WireMessage::SubscriptionSet { data, .. } => {
                let unique = data
                    .streams
                    .iter()
                    .map(|cursor| cursor.stream.as_str())
                    .collect::<HashSet<_>>();
                if unique.len() != data.streams.len() {
                    bail!("duplicate stream subscription");
                }
            }
            WireMessage::EventBatch { data, .. } => {
                if data
                    .events
                    .windows(2)
                    .any(|pair| pair[1].seq != pair[0].seq + 1)
                {
                    bail!("non-consecutive event batch");
                }
                if let (Some(first), Some(last)) = (data.events.first(), data.events.last()) {
                    if data.first_seq != Some(first.seq) || data.last_seq != Some(last.seq) {
                        bail!("event batch bounds do not match events");
                    }
                } else if data.first_seq.is_some() || data.last_seq.is_some() {
                    bail!("empty event batch must have null bounds");
                }
            }
            WireMessage::Unknown => bail!("unknown Protocol v1 message kind"),
            _ => {}
        }
        Ok(message)
    }

    pub(crate) fn encode(message: &WireMessage) -> Result<String> {
        Ok(serde_json::to_string(message)?)
    }

    pub(crate) fn result_payload(message: WireMessage, method: &str) -> Result<Value> {
        match message {
            WireMessage::Response { data, .. } if data.ok && data.method == method => {
                Ok(data.result)
            }
            WireMessage::Error { data, .. } => {
                bail!("protocol error {}: {}", data.code, data.message)
            }
            _ => bail!("unexpected protocol response for {method}"),
        }
    }
}

async fn next_wire_message(socket: &mut Socket) -> Result<WireMessage> {
    loop {
        let frame = socket
            .next()
            .await
            .ok_or_else(|| anyhow::anyhow!("daemon closed the protocol connection"))??;
        if let Some(message) = decode_frame(frame)? {
            return Ok(message);
        }
    }
}

fn decode_frame(frame: Message) -> Result<Option<WireMessage>> {
    match frame {
        Message::Text(text) => Ok(Some(ReadOnlyProtocolClient::decode(&text)?)),
        Message::Binary(bytes) => Ok(Some(ReadOnlyProtocolClient::decode(std::str::from_utf8(
            &bytes,
        )?)?)),
        Message::Close(frame) => bail!("daemon closed the protocol connection: {frame:?}"),
        Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_hdr_async;

    type TestSocket = WebSocketStream<TcpStream>;

    #[test]
    fn required_capabilities_cover_the_chat_slice() {
        for capability in [
            "operation.conversation.create",
            "operation.agent.create",
            "operation.run.start",
        ] {
            assert!(CAPABILITIES.contains(&capability));
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    #[allow(
        clippy::too_many_lines,
        reason = "the fake-daemon script is intentionally linear so protocol ordering is explicit"
    )]
    async fn first_prompt_subscribes_before_starting_the_run() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_hdr_async(stream, |request: &http::Request<()>, response| {
                assert_eq!(
                    request.headers().get(http::header::AUTHORIZATION).unwrap(),
                    "Bearer fixture-token"
                );
                Ok(response)
            })
            .await
            .unwrap();
            let hello = receive_json(&mut socket).await;
            let client = hello["source"].clone();
            send_json(
                &mut socket,
                server_message(
                    "welcome",
                    json!({
                        "sessionId": "ses_test",
                        "acceptingPeer": { "role": "workbench_server" },
                        "acceptedVersion": 1,
                        "capabilities": CAPABILITIES,
                        "encoding": "json",
                        "limits": {
                            "maxMessageBytes": 1_048_576,
                            "maxBatchEvents": 256,
                            "maxBatchBytes": 524_288
                        },
                        "heartbeat": { "intervalMs": 10000, "timeoutMs": 30000 }
                    }),
                    &client,
                    None,
                ),
            )
            .await;
            assert_eq!(receive_json(&mut socket).await["kind"], "ready");

            let workspace = receive_json(&mut socket).await;
            assert_eq!(workspace["data"]["method"], "snapshot.workspace.get");
            reply(
                &mut socket,
                &workspace,
                json!({
                    "snapshot": {
                        "projects": [{ "id": "proj_test", "name": "Test", "dir": "/tmp/test" }],
                        "conversations": [],
                        "agents": [], "tasks": [], "approvals": [], "userQuestions": [],
                        "planReviews": [], "workers": []
                    },
                    "cursor": { "streams": [{ "stream": "workspace", "processedSeq": 0 }] },
                    "generatedAt": "2026-01-01T00:00:00.000Z"
                }),
                &client,
            )
            .await;
            accept_subscription(&mut socket, &client).await;

            let create = receive_json(&mut socket).await;
            assert_eq!(create["data"]["method"], "conversation.create");
            reply(
                &mut socket,
                &create,
                json!({ "conversation": {
                    "id": "conv_test", "projectId": "proj_test", "title": "New Conversation"
                }}),
                &client,
            )
            .await;
            let agent = receive_json(&mut socket).await;
            assert_eq!(agent["data"]["method"], "agent.create");
            reply(
                &mut socket,
                &agent,
                json!({ "agent": { "id": "agent_test", "conversationId": "conv_test" } }),
                &client,
            )
            .await;
            let snapshot = receive_json(&mut socket).await;
            assert_eq!(snapshot["data"]["method"], "snapshot.conversation.get");
            reply(
                &mut socket,
                &snapshot,
                json!({
                    "snapshot": {
                        "conversation": {
                            "id": "conv_test", "title": "New Conversation",
                            "activeAgentId": "agent_test"
                        },
                        "entries": [], "cursorSeq": 0
                    },
                    "cursor": {
                        "streams": [{ "stream": "conv/conv_test", "processedSeq": 0 }]
                    },
                    "generatedAt": "2026-01-01T00:00:00.000Z"
                }),
                &client,
            )
            .await;
            accept_subscription(&mut socket, &client).await;
            let run = receive_json(&mut socket).await;
            assert_eq!(run["data"]["method"], "run.start");
            reply(
                &mut socket,
                &run,
                json!({
                    "accepted": true, "conversationId": "conv_test",
                    "agentId": "agent_test", "runId": "run_test", "status": "accepted"
                }),
                &client,
            )
            .await;
        });

        let connection =
            DaemonConnection::for_test(&format!("http://{address}"), "fixture-token").unwrap();
        let handle = ProtocolHandle::start(connection);
        let events = handle.events();
        loop {
            if matches!(events.recv().await.unwrap(), ProtocolEvent::Connected) {
                break;
            }
        }
        handle
            .send(ProtocolCommand::StartDraft {
                project_id: "proj_test".into(),
                text: "Hello".into(),
            })
            .unwrap();
        loop {
            if matches!(events.recv().await.unwrap(), ProtocolEvent::PromptAccepted) {
                break;
            }
        }
        handle.send(ProtocolCommand::Shutdown).unwrap();
        server.await.unwrap();
    }

    async fn receive_json(socket: &mut TestSocket) -> Value {
        loop {
            match socket.next().await.unwrap().unwrap() {
                Message::Text(text) => return serde_json::from_str(&text).unwrap(),
                Message::Binary(bytes) => return serde_json::from_slice(&bytes).unwrap(),
                _ => {}
            }
        }
    }

    async fn send_json(socket: &mut TestSocket, value: Value) {
        socket
            .send(Message::Text(value.to_string().into()))
            .await
            .unwrap();
    }

    #[allow(
        clippy::needless_pass_by_value,
        reason = "test messages transfer owned JSON payloads into their envelopes"
    )]
    fn server_message(kind: &str, data: Value, target: &Value, reply_to: Option<&str>) -> Value {
        let mut message = json!({
            "protocol": "nerve", "version": 1,
            "id": format!("msg_{}", uuid::Uuid::new_v4()),
            "kind": kind, "ts": "2026-01-01T00:00:00.000Z",
            "source": { "role": "workbench_server" },
            "target": target, "data": data
        });
        if let Some(reply_to) = reply_to {
            message["replyTo"] = json!(reply_to);
            message["correlationId"] = json!(reply_to);
        }
        message
    }

    async fn reply(socket: &mut TestSocket, request: &Value, result: Value, client: &Value) {
        send_json(
            socket,
            server_message(
                "response",
                json!({
                    "ok": true,
                    "method": request["data"]["method"],
                    "result": result
                }),
                client,
                request["id"].as_str(),
            ),
        )
        .await;
    }

    async fn accept_subscription(socket: &mut TestSocket, client: &Value) {
        let request = receive_json(socket).await;
        assert_eq!(request["kind"], "stream.subscription.set");
        let streams = request["data"]["streams"]
            .as_array()
            .unwrap()
            .iter()
            .map(|cursor| {
                json!({
                    "stream": cursor["stream"],
                    "latestSeq": cursor["processedSeq"],
                    "earliestAvailableSeq": 0,
                    "mode": "live"
                })
            })
            .collect::<Vec<_>>();
        send_json(
            socket,
            server_message(
                "stream.subscription.updated",
                json!({
                    "sessionId": "ses_test",
                    "subscriptionId": request["data"]["subscriptionId"],
                    "accepted": true,
                    "streams": streams
                }),
                client,
                None,
            ),
        )
        .await;
    }
}
