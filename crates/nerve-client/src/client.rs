use std::{sync::mpsc, thread, time::Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::{sync::mpsc as tokio_mpsc, time};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest, http::header::AUTHORIZATION},
};

use crate::{
    ClientError, ClientSession, ConnectionConfig, ConversationSnapshot, EventBatchData, HttpClient,
    NerveMessage, PeerDescriptor, Result, SnapshotResponse, StreamCursor, SubscriptionUpdatedData,
    WorkspaceSnapshot,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ConnectionState {
    Connecting,
    Live,
    Reconnecting,
    Closed,
}

#[derive(Clone, Debug)]
pub enum ClientEvent {
    Connection(ConnectionState),
    Workspace(Box<SnapshotResponse<WorkspaceSnapshot>>),
    Conversation(Box<SnapshotResponse<ConversationSnapshot>>),
    Error(String),
}

#[derive(Debug)]
enum ClientCommand {
    SelectConversation(Option<String>),
    Shutdown,
}

pub struct ClientHandle {
    commands: tokio_mpsc::UnboundedSender<ClientCommand>,
    events: mpsc::Receiver<ClientEvent>,
    thread: Option<thread::JoinHandle<()>>,
}

impl ClientHandle {
    pub fn start(config: ConnectionConfig) -> Self {
        let (command_tx, command_rx) = tokio_mpsc::unbounded_channel();
        let (event_tx, event_rx) = mpsc::channel();
        let actor_thread = thread::Builder::new()
            .name("nerve-client".into())
            .spawn(move || {
                let runtime = tokio::runtime::Runtime::new().expect("create Nerve client runtime");
                runtime.block_on(run_actor(config, command_rx, event_tx));
            })
            .expect("start Nerve client thread");
        Self {
            commands: command_tx,
            events: event_rx,
            thread: Some(actor_thread),
        }
    }

    pub fn select_conversation(&self, conversation_id: Option<String>) {
        let _ = self
            .commands
            .send(ClientCommand::SelectConversation(conversation_id));
    }

    pub fn try_recv(&self) -> Option<ClientEvent> {
        self.events.try_recv().ok()
    }

    pub fn shutdown(&mut self) {
        let _ = self.commands.send(ClientCommand::Shutdown);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for ClientHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

async fn run_actor(
    config: ConnectionConfig,
    mut commands: tokio_mpsc::UnboundedReceiver<ClientCommand>,
    events: mpsc::Sender<ClientEvent>,
) {
    let source = PeerDescriptor {
        role: "ui".into(),
        id: Some(format!("client_{}", uuid::Uuid::new_v4().simple())),
        name: Some("Nerve GPUI".into()),
        instance_id: Some(format!("instance_{}", uuid::Uuid::new_v4().simple())),
    };
    let http = match HttpClient::new(config.clone(), source.clone()) {
        Ok(client) => client,
        Err(error) => {
            send_error(&events, error);
            return;
        }
    };
    let _ = events.send(ClientEvent::Connection(ConnectionState::Connecting));
    if let Err(error) = http.health().await {
        send_error(&events, error);
        return;
    }
    let mut workspace = match http.workspace_snapshot().await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            send_error(&events, error);
            return;
        }
    };
    let _ = events.send(ClientEvent::Workspace(Box::new(workspace.clone())));
    let mut selected: Option<String> = None;
    let mut conversation: Option<SnapshotResponse<ConversationSnapshot>> = None;
    let mut attempt = 0_u32;

    loop {
        while let Ok(command) = commands.try_recv() {
            match command {
                ClientCommand::Shutdown => {
                    let _ = events.send(ClientEvent::Connection(ConnectionState::Closed));
                    return;
                }
                ClientCommand::SelectConversation(id) => selected = id,
            }
        }
        let _ = events.send(ClientEvent::Connection(if attempt == 0 {
            ConnectionState::Connecting
        } else {
            ConnectionState::Reconnecting
        }));
        let result = run_socket(
            &config,
            &http,
            &source,
            &mut commands,
            &events,
            &mut workspace,
            &mut selected,
            &mut conversation,
        )
        .await;
        match result {
            Ok(SocketExit::Shutdown) => {
                let _ = events.send(ClientEvent::Connection(ConnectionState::Closed));
                return;
            }
            Err(error) => send_error(&events, error),
        }
        attempt = attempt.saturating_add(1);
        let delay = 250_u64
            .saturating_mul(2_u64.saturating_pow(attempt.min(5)))
            .min(5_000);
        time::sleep(Duration::from_millis(delay)).await;
    }
}

enum SocketExit {
    Shutdown,
}

#[allow(clippy::too_many_arguments)]
async fn run_socket(
    config: &ConnectionConfig,
    http: &HttpClient,
    source: &PeerDescriptor,
    commands: &mut tokio_mpsc::UnboundedReceiver<ClientCommand>,
    events: &mpsc::Sender<ClientEvent>,
    workspace: &mut SnapshotResponse<WorkspaceSnapshot>,
    selected: &mut Option<String>,
    conversation: &mut Option<SnapshotResponse<ConversationSnapshot>>,
) -> Result<SocketExit> {
    if conversation.is_none() {
        if let Some(id) = selected.as_deref() {
            let snapshot = http.conversation_snapshot(id).await?;
            let _ = events.send(ClientEvent::Conversation(Box::new(snapshot.clone())));
            *conversation = Some(snapshot);
        }
    }
    let mut ws_url = config.origin.clone();
    ws_url
        .set_scheme(if config.origin.scheme() == "https" {
            "wss"
        } else {
            "ws"
        })
        .map_err(|()| ClientError::Configuration("cannot derive WebSocket URL".into()))?;
    ws_url.set_path("/ws");
    let mut request = ws_url.as_str().into_client_request()?;
    request.headers_mut().insert(
        AUTHORIZATION,
        format!("Bearer {}", config.token.expose())
            .parse()
            .map_err(|_| ClientError::Configuration("invalid daemon token".into()))?,
    );
    let (socket, _) = connect_async(request).await?;
    let (mut sink, mut stream) = socket.split();
    let mut cursors = workspace.cursor.streams.clone();
    if let Some(snapshot) = conversation.as_ref() {
        merge_cursors(&mut cursors, &snapshot.cursor.streams);
    }
    let mut session = ClientSession::new(source.clone(), cursors);
    send_json(&mut sink, &session.hello()?).await?;
    let welcome_message = time::timeout(Duration::from_secs(10), receive_json(&mut stream))
        .await
        .map_err(|_| ClientError::Protocol("protocol handshake timed out".into()))??;
    let (welcome, ready) = session.accept_welcome(&welcome_message)?;
    send_json(&mut sink, &ready).await?;
    send_json(&mut sink, &session.subscription()?).await?;
    let _ = events.send(ClientEvent::Connection(ConnectionState::Live));
    let mut heartbeat = time::interval(Duration::from_millis(welcome.heartbeat.interval_ms));
    let mut watchdog = time::interval(Duration::from_millis(welcome.heartbeat.interval_ms.max(1)));
    let mut last_received = time::Instant::now();

    loop {
        tokio::select! {
            _ = heartbeat.tick() => send_json(&mut sink, &session.heartbeat()?).await?,
            _ = watchdog.tick() => {
                if last_received.elapsed() > Duration::from_millis(welcome.heartbeat.timeout_ms) {
                    return Err(ClientError::Protocol("protocol heartbeat timed out".into()));
                }
            }
            command = commands.recv() => match command {
                Some(ClientCommand::Shutdown) | None => {
                    if let Some(goodbye) = session.goodbye() { let _ = send_json(&mut sink, &goodbye).await; }
                    let _ = sink.close().await;
                    return Ok(SocketExit::Shutdown);
                }
                Some(ClientCommand::SelectConversation(id)) => {
                    *selected = id;
                    *conversation = if let Some(id) = selected.as_deref() {
                        let snapshot = http.conversation_snapshot(id).await?;
                        let _ = events.send(ClientEvent::Conversation(Box::new(snapshot.clone())));
                        Some(snapshot)
                    } else { None };
                    let mut cursors = workspace.cursor.streams.clone();
                    if let Some(snapshot) = conversation.as_ref() { merge_cursors(&mut cursors, &snapshot.cursor.streams); }
                    session.set_streams(cursors);
                    send_json(&mut sink, &session.subscription()?).await?;
                }
            },
            message = stream.next() => {
                let message = message.ok_or_else(|| ClientError::Protocol("WebSocket closed".into()))??;
                if !message.is_text() { continue; }
                last_received = time::Instant::now();
                let envelope: NerveMessage<Value> = serde_json::from_str(message.to_text()?)?;
                crate::http::validate_envelope(&envelope)?;
                session.validate_server_message(&envelope)?;
                match envelope.kind.as_str() {
                    "heartbeat" | "event.notify" => {}
                    "goodbye" => return Err(ClientError::Protocol("server closed protocol session".into())),
                    "error" => return Err(ClientError::Protocol(envelope.data.get("message").and_then(Value::as_str).unwrap_or("protocol error").into())),
                    "stream.subscription.updated" => {
                        let update: SubscriptionUpdatedData = serde_json::from_value(envelope.data)?;
                        let snapshot_streams = session.apply_subscription(&update)?;
                        if !snapshot_streams.is_empty() {
                            for stream_name in snapshot_streams {
                                refresh_stream(&stream_name, http, events, workspace, conversation, selected).await?;
                            }
                            install_snapshot_cursors(&mut session, workspace, conversation.as_ref());
                            send_json(&mut sink, &session.subscription()?).await?;
                        }
                    }
                    "event.batch" => {
                        let batch: EventBatchData = serde_json::from_value(envelope.data)?;
                        if let Err(ClientError::SnapshotRequired(stream_name)) = session.validate_batch(&batch) {
                            refresh_stream(&stream_name, http, events, workspace, conversation, selected).await?;
                            install_snapshot_cursors(&mut session, workspace, conversation.as_ref());
                            send_json(&mut sink, &session.subscription()?).await?;
                            continue;
                        }
                        session.validate_batch(&batch)?;
                        refresh_stream(&batch.stream, http, events, workspace, conversation, selected).await?;
                        session.mark_batch_processed(&batch);
                    }
                    _ => {}
                }
            }
        }
    }
}

async fn refresh_stream(
    stream: &str,
    http: &HttpClient,
    events: &mpsc::Sender<ClientEvent>,
    workspace: &mut SnapshotResponse<WorkspaceSnapshot>,
    conversation: &mut Option<SnapshotResponse<ConversationSnapshot>>,
    selected: &Option<String>,
) -> Result<()> {
    if stream == "workspace" {
        *workspace = http.workspace_snapshot().await?;
        let _ = events.send(ClientEvent::Workspace(Box::new(workspace.clone())));
    } else if selected
        .as_deref()
        .is_some_and(|id| stream == format!("conv/{id}"))
    {
        let snapshot = http
            .conversation_snapshot(selected.as_deref().expect("selected id"))
            .await?;
        let _ = events.send(ClientEvent::Conversation(Box::new(snapshot.clone())));
        *conversation = Some(snapshot);
    }
    Ok(())
}

fn install_snapshot_cursors(
    session: &mut ClientSession,
    workspace: &SnapshotResponse<WorkspaceSnapshot>,
    conversation: Option<&SnapshotResponse<ConversationSnapshot>>,
) {
    let mut cursors = workspace.cursor.streams.clone();
    if let Some(snapshot) = conversation {
        merge_cursors(&mut cursors, &snapshot.cursor.streams);
    }
    session.set_streams(cursors);
}

fn merge_cursors(target: &mut Vec<StreamCursor>, incoming: &[StreamCursor]) {
    for cursor in incoming {
        if let Some(existing) = target.iter_mut().find(|item| item.stream == cursor.stream) {
            *existing = cursor.clone();
        } else {
            target.push(cursor.clone());
        }
    }
}

async fn send_json<S>(sink: &mut S, message: &NerveMessage<Value>) -> Result<()>
where
    S: futures_util::Sink<Message> + Unpin,
    ClientError: From<S::Error>,
{
    sink.send(Message::Text(serde_json::to_string(message)?.into()))
        .await
        .map_err(ClientError::from)
}

async fn receive_json<S>(stream: &mut S) -> Result<NerveMessage<Value>>
where
    S: futures_util::Stream<
            Item = std::result::Result<Message, tokio_tungstenite::tungstenite::Error>,
        > + Unpin,
{
    loop {
        let message = stream
            .next()
            .await
            .ok_or_else(|| ClientError::Protocol("WebSocket closed during handshake".into()))??;
        if message.is_text() {
            return serde_json::from_str(message.to_text()?).map_err(ClientError::from);
        }
    }
}

fn send_error(events: &mpsc::Sender<ClientEvent>, error: ClientError) {
    let _ = events.send(ClientEvent::Error(error.to_string()));
}
