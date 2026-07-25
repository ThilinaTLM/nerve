use std::collections::{BTreeMap, HashSet};

use anyhow::{Result, bail};
use futures_util::{SinkExt as _, StreamExt as _};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{Message, client::IntoClientRequest as _},
};

use crate::daemon::DaemonConnection;

use super::{
    envelope::Envelope,
    messages::{
        CAPABILITIES, EventBatchData, HelloData, ReadyData, RequestData, StreamCursor,
        SubscriptionSetData, SubscriptionUpdatedData, WelcomeData, WireMessage,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConnectionState {
    Disconnected,
    AwaitingWelcome,
    Ready,
    Recovering,
}

#[derive(Debug)]
pub(crate) struct ReadOnlyProtocolClient {
    connection: DaemonConnection,
    state: ConnectionState,
    session_id: Option<String>,
    cursors: BTreeMap<String, u64>,
    active_streams: HashSet<String>,
    accepting_peer: Option<super::envelope::PeerDescriptor>,
    source_peer: super::envelope::PeerDescriptor,
}

impl ReadOnlyProtocolClient {
    pub(crate) fn new(connection: DaemonConnection) -> Self {
        let client_id = format!("native_{}", uuid::Uuid::new_v4());
        Self {
            connection,
            state: ConnectionState::Disconnected,
            session_id: None,
            cursors: BTreeMap::new(),
            active_streams: HashSet::new(),
            accepting_peer: None,
            source_peer: super::envelope::PeerDescriptor {
                role: super::envelope::PeerRole::Ui,
                id: Some(client_id),
                name: Some("Nerve Native Evaluation".into()),
                instance_id: Some(uuid::Uuid::new_v4().to_string()),
            },
        }
    }

    pub(crate) fn websocket_url(&self) -> &url::Url {
        &self.connection.websocket_url
    }

    fn envelope(&self) -> Envelope {
        let mut envelope = Envelope::ui(format!("msg_{}", uuid::Uuid::new_v4()));
        envelope.source = self.source_peer.clone();
        if let Some(peer) = &self.accepting_peer {
            envelope.target = peer.clone();
        }
        envelope
    }

    pub(crate) async fn load_workspace_snapshot(&mut self) -> Result<Value> {
        tokio::time::timeout(
            std::time::Duration::from_secs(15),
            self.load_workspace_snapshot_inner(),
        )
        .await
        .map_err(|_| anyhow::anyhow!("timed out loading the workspace snapshot"))?
    }

    async fn load_workspace_snapshot_inner(&mut self) -> Result<Value> {
        let mut request = self
            .connection
            .websocket_url
            .as_str()
            .into_client_request()?;
        self.connection.authorize_websocket_request(&mut request)?;
        let (mut socket, _) = connect_async(request).await?;
        tracing::info!("native protocol transport connected");

        socket
            .send(Message::Text(Self::encode(&self.begin())?.into()))
            .await?;
        let welcome = next_wire_message(&mut socket).await?;
        tracing::info!("native protocol welcome received");
        let WireMessage::Welcome { data, .. } = welcome else {
            bail!("expected welcome as first daemon message");
        };
        let ready = self.accept_welcome(data)?;
        socket
            .send(Message::Text(Self::encode(&ready)?.into()))
            .await?;

        let snapshot_request = self.snapshot_request(None)?;
        let request_id = serde_json::to_value(&snapshot_request)?
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("snapshot request did not contain an id"))?
            .to_owned();
        socket
            .send(Message::Text(Self::encode(&snapshot_request)?.into()))
            .await?;
        tracing::info!("native workspace snapshot request sent");

        loop {
            let message = next_wire_message(&mut socket).await?;
            match &message {
                WireMessage::Response { envelope, data }
                    if data.method == "snapshot.workspace.get"
                        && (envelope.reply_to.as_deref() == Some(request_id.as_str())
                            || envelope.correlation_id.as_deref() == Some(request_id.as_str())) =>
                {
                    return Self::result_payload(message, "snapshot.workspace.get");
                }
                WireMessage::Error { data, .. } => {
                    bail!("protocol error {}: {}", data.code, data.message);
                }
                _ => {}
            }
            if let WireMessage::Heartbeat { data, .. } = message {
                let heartbeat = WireMessage::Heartbeat {
                    envelope: self.envelope(),
                    data,
                };
                socket
                    .send(Message::Text(Self::encode(&heartbeat)?.into()))
                    .await?;
            }
        }
    }

    pub(crate) fn begin(&mut self) -> WireMessage {
        self.state = ConnectionState::AwaitingWelcome;
        WireMessage::Hello {
            envelope: self.envelope(),
            data: HelloData {
                requested_version: 1,
                capabilities: CAPABILITIES.iter().map(ToString::to_string).collect(),
                required_capabilities: Some(CAPABILITIES.iter().map(ToString::to_string).collect()),
                encodings: vec!["json".into()],
                preferences: None,
            },
        }
    }

    pub(crate) fn accept_welcome(&mut self, welcome: WelcomeData) -> Result<WireMessage> {
        if self.state != ConnectionState::AwaitingWelcome {
            bail!("welcome received outside negotiation");
        }
        for capability in CAPABILITIES {
            if !welcome.capabilities.iter().any(|value| value == capability) {
                bail!("server did not negotiate required capability {capability}");
            }
        }
        let session_id = welcome.session_id;
        self.accepting_peer = Some(welcome.accepting_peer);
        self.session_id = Some(session_id.clone());
        self.state = ConnectionState::Ready;
        Ok(WireMessage::Ready {
            envelope: self.envelope(),
            data: ReadyData {
                session_id,
                status: None,
            },
        })
    }

    pub(crate) fn snapshot_request(&self, conversation_id: Option<&str>) -> Result<WireMessage> {
        if self.state != ConnectionState::Ready {
            bail!("snapshot request requires a ready session");
        }
        let (method, params) = conversation_id.map_or_else(
            || ("snapshot.workspace.get", Some(serde_json::json!({}))),
            |id| {
                (
                    "snapshot.conversation.get",
                    Some(serde_json::json!({ "conversationId": id })),
                )
            },
        );
        Ok(WireMessage::Request {
            envelope: self.envelope(),
            data: RequestData {
                method: method.into(),
                params,
                idempotency_key: None,
                timeout_ms: Some(30_000),
                expect: None,
            },
        })
    }

    pub(crate) fn install_snapshot_cursors(&mut self, cursors: &[StreamCursor]) {
        self.cursors = cursors
            .iter()
            .map(|cursor| (cursor.stream.clone(), cursor.processed_seq))
            .collect();
    }

    pub(crate) fn subscription_request(&self) -> Result<WireMessage> {
        let session_id = self
            .session_id
            .clone()
            .ok_or_else(|| anyhow::anyhow!("missing session"))?;
        Ok(WireMessage::SubscriptionSet {
            envelope: self.envelope(),
            data: SubscriptionSetData {
                session_id,
                subscription_id: format!("sub_{}", uuid::Uuid::new_v4()),
                streams: self
                    .cursors
                    .iter()
                    .map(|(stream, processed_seq)| StreamCursor {
                        stream: stream.clone(),
                        processed_seq: *processed_seq,
                    })
                    .collect(),
            },
        })
    }

    pub(crate) fn accept_subscription(
        &mut self,
        update: &SubscriptionUpdatedData,
    ) -> Result<Vec<String>> {
        if !update.accepted {
            bail!("stream subscription was rejected");
        }
        let mut recovery = Vec::new();
        self.active_streams.clear();
        for stream in &update.streams {
            match stream.mode.as_str() {
                "live" | "replay" => {
                    self.active_streams.insert(stream.stream.clone());
                }
                "snapshot_required" => recovery.push(stream.stream.clone()),
                "unavailable" => {
                    self.cursors.remove(&stream.stream);
                }
                other => bail!("unknown subscription mode {other}"),
            }
        }
        self.state = if recovery.is_empty() {
            ConnectionState::Ready
        } else {
            ConnectionState::Recovering
        };
        Ok(recovery)
    }

    pub(crate) fn apply_batch<F>(&mut self, batch: &EventBatchData, mut apply: F) -> Result<()>
    where
        F: FnMut(&str, &super::messages::EventEnvelope) -> Result<()>,
    {
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
                self.state = ConnectionState::Recovering;
                bail!(
                    "event gap on {}: expected {expected}, received {}",
                    batch.stream,
                    event.seq
                );
            }
            apply(&batch.stream, event)?;
            self.cursors.insert(batch.stream.clone(), event.seq);
            expected += 1;
        }
        Ok(())
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

async fn next_wire_message(
    socket: &mut WebSocketStream<MaybeTlsStream<TcpStream>>,
) -> Result<WireMessage> {
    loop {
        let frame = socket
            .next()
            .await
            .ok_or_else(|| anyhow::anyhow!("daemon closed the protocol connection"))??;
        match frame {
            Message::Text(text) => return ReadOnlyProtocolClient::decode(&text),
            Message::Binary(bytes) => {
                let text = std::str::from_utf8(&bytes)?;
                return ReadOnlyProtocolClient::decode(text);
            }
            Message::Close(frame) => {
                bail!("daemon closed the protocol connection: {frame:?}");
            }
            Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::{HeartbeatPolicy, ProtocolLimits, StreamState};

    fn connection() -> DaemonConnection {
        DaemonConnection::for_test("http://127.0.0.1:3747", "fixture").unwrap()
    }

    fn welcome() -> WelcomeData {
        WelcomeData {
            session_id: "ses_test".into(),
            accepting_peer: super::super::envelope::PeerDescriptor {
                role: super::super::envelope::PeerRole::WorkbenchServer,
                id: None,
                name: None,
                instance_id: None,
            },
            accepted_version: 1,
            capabilities: CAPABILITIES.iter().map(ToString::to_string).collect(),
            encoding: "json".into(),
            limits: ProtocolLimits {
                max_message_bytes: 1_000_000,
                max_batch_events: 100,
                max_batch_bytes: 500_000,
            },
            heartbeat: HeartbeatPolicy {
                interval_ms: 10_000,
                timeout_ms: 30_000,
            },
        }
    }

    #[test]
    fn keeps_the_negotiated_client_peer_stable() {
        let mut client = ReadOnlyProtocolClient::new(connection());
        let WireMessage::Hello {
            envelope: hello, ..
        } = client.begin()
        else {
            panic!("begin must produce hello");
        };
        let WireMessage::Ready {
            envelope: ready, ..
        } = client.accept_welcome(welcome()).unwrap()
        else {
            panic!("welcome must produce ready");
        };
        assert_eq!(hello.source, ready.source);
    }

    #[test]
    fn advances_cursor_only_after_reducer_success() {
        let mut client = ReadOnlyProtocolClient::new(connection());
        client.begin();
        client.accept_welcome(welcome()).unwrap();
        client.install_snapshot_cursors(&[StreamCursor {
            stream: "workspace".into(),
            processed_seq: 0,
        }]);
        client
            .accept_subscription(&SubscriptionUpdatedData {
                session_id: "ses_test".into(),
                subscription_id: "sub_test".into(),
                accepted: true,
                streams: vec![StreamState {
                    stream: "workspace".into(),
                    latest_seq: 1,
                    earliest_available_seq: 1,
                    mode: "live".into(),
                }],
                reason: None,
            })
            .unwrap();
        let batch = EventBatchData {
            stream: "workspace".into(),
            batch_id: "batch".into(),
            reason: "live".into(),
            events: vec![super::super::messages::EventEnvelope {
                seq: 1,
                id: "evt_1".into(),
                ts: "2026-01-01T00:00:00.000Z".into(),
                event_type: "fixture".into(),
                data: serde_json::json!({}),
            }],
            first_seq: Some(1),
            last_seq: Some(1),
        };
        assert!(
            client
                .apply_batch(&batch, |_, _| bail!("reducer failed"))
                .is_err()
        );
        assert_eq!(client.cursors["workspace"], 0);
        client.apply_batch(&batch, |_, _| Ok(())).unwrap();
        assert_eq!(client.cursors["workspace"], 1);
    }
}
