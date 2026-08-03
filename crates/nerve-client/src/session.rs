use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::{
    ClientError, EventBatchData, NerveMessage, PeerDescriptor, Result, StreamCursor,
    SubscriptionUpdatedData, WelcomeData, new_message,
};

pub const CAPABILITIES: &[&str] = &[
    "encoding.json",
    "event.batch",
    "event.notify",
    "stream.subscription.v1",
    "snapshot.workspace",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionState {
    Idle,
    HelloSent,
    Ready,
    Closed,
}

pub struct ClientSession {
    state: SessionState,
    source: PeerDescriptor,
    accepting_peer: Option<PeerDescriptor>,
    session_id: Option<String>,
    cursors: BTreeMap<String, u64>,
}

impl ClientSession {
    pub fn new(source: PeerDescriptor, cursors: impl IntoIterator<Item = StreamCursor>) -> Self {
        Self {
            state: SessionState::Idle,
            source,
            accepting_peer: None,
            session_id: None,
            cursors: cursors
                .into_iter()
                .map(|cursor| (cursor.stream, cursor.processed_seq))
                .collect(),
        }
    }

    pub fn state(&self) -> SessionState {
        self.state
    }

    pub fn hello(&mut self) -> Result<NerveMessage<Value>> {
        if self.state != SessionState::Idle {
            return Err(ClientError::Protocol(
                "hello sent from invalid session state".into(),
            ));
        }
        self.state = SessionState::HelloSent;
        Ok(new_message(
            "hello",
            self.source.clone(),
            PeerDescriptor::server(),
            json!({
                "requestedVersion": 1,
                "capabilities": CAPABILITIES,
                "requiredCapabilities": CAPABILITIES,
                "encodings": ["json"]
            }),
        ))
    }

    pub fn accept_welcome(
        &mut self,
        message: &NerveMessage<Value>,
    ) -> Result<(WelcomeData, NerveMessage<Value>)> {
        if self.state != SessionState::HelloSent || message.kind != "welcome" {
            return Err(ClientError::Protocol("expected welcome after hello".into()));
        }
        if message.target.role != self.source.role || message.target.id != self.source.id {
            return Err(ClientError::Protocol(
                "welcome target does not match client peer".into(),
            ));
        }
        let welcome: WelcomeData = serde_json::from_value(message.data.clone())?;
        if welcome.accepted_version != 1 || welcome.encoding != "json" {
            return Err(ClientError::Protocol(
                "server negotiated unsupported protocol".into(),
            ));
        }
        for capability in CAPABILITIES {
            if !welcome.capabilities.iter().any(|item| item == capability) {
                return Err(ClientError::Protocol(format!(
                    "server did not negotiate {capability}"
                )));
            }
        }
        if message.source != welcome.accepting_peer
            || welcome.accepting_peer.role != "workbench_server"
        {
            return Err(ClientError::Protocol(
                "welcome source does not match accepting peer".into(),
            ));
        }
        self.accepting_peer = Some(welcome.accepting_peer.clone());
        self.session_id = Some(welcome.session_id.clone());
        self.state = SessionState::Ready;
        let ready = self.message(
            "ready",
            json!({ "sessionId": welcome.session_id, "status": "ready" }),
        )?;
        Ok((welcome, ready))
    }

    pub fn subscription(&self) -> Result<NerveMessage<Value>> {
        let session_id = self
            .session_id
            .as_deref()
            .ok_or_else(|| ClientError::Protocol("session is not ready".into()))?;
        let streams: Vec<StreamCursor> = self
            .cursors
            .iter()
            .map(|(stream, processed_seq)| StreamCursor {
                stream: stream.clone(),
                processed_seq: *processed_seq,
            })
            .collect();
        self.message(
            "stream.subscription.set",
            json!({
                "sessionId": session_id,
                "subscriptionId": format!("sub_{}", uuid::Uuid::new_v4().simple()),
                "streams": streams,
            }),
        )
    }

    pub fn heartbeat(&self) -> Result<NerveMessage<Value>> {
        let session_id = self
            .session_id
            .as_deref()
            .ok_or_else(|| ClientError::Protocol("session is not ready".into()))?;
        self.message("heartbeat", json!({ "sessionId": session_id, "sentAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) }))
    }

    pub fn goodbye(&mut self) -> Option<NerveMessage<Value>> {
        let session_id = self.session_id.clone()?;
        let message = self
            .message(
                "goodbye",
                json!({ "sessionId": session_id, "reason": "client_closing" }),
            )
            .ok();
        self.state = SessionState::Closed;
        message
    }

    pub fn validate_server_message(&self, message: &NerveMessage<Value>) -> Result<()> {
        let accepting_peer = self
            .accepting_peer
            .as_ref()
            .ok_or_else(|| ClientError::Protocol("session is not ready".into()))?;
        if message.source.role != accepting_peer.role
            || message.source.id != accepting_peer.id
            || message.target.role != self.source.role
            || message.target.id != self.source.id
        {
            return Err(ClientError::Protocol(
                "server message peers do not match the negotiated session".into(),
            ));
        }
        Ok(())
    }

    pub fn set_streams(&mut self, streams: impl IntoIterator<Item = StreamCursor>) {
        self.cursors = streams
            .into_iter()
            .map(|cursor| (cursor.stream, cursor.processed_seq))
            .collect();
    }

    pub fn validate_batch(&self, batch: &EventBatchData) -> Result<()> {
        batch.validate_dense().map_err(ClientError::Protocol)?;
        if let Some(first) = batch.first_seq {
            let processed = self.cursors.get(&batch.stream).copied().unwrap_or(0);
            if first != processed + 1 {
                return Err(ClientError::SnapshotRequired(batch.stream.clone()));
            }
        }
        Ok(())
    }

    pub fn mark_batch_processed(&mut self, batch: &EventBatchData) {
        if let Some(last) = batch.last_seq {
            self.cursors.insert(batch.stream.clone(), last);
        }
    }

    pub fn apply_subscription(&mut self, data: &SubscriptionUpdatedData) -> Result<Vec<String>> {
        if self.session_id.as_deref() != Some(data.session_id.as_str()) {
            return Err(ClientError::Protocol(
                "subscription session does not match".into(),
            ));
        }
        if !data.accepted {
            return Err(ClientError::Protocol(
                data.reason
                    .clone()
                    .unwrap_or_else(|| "subscription rejected".into()),
            ));
        }
        Ok(data
            .streams
            .iter()
            .filter(|stream| stream.mode == "snapshot_required")
            .map(|stream| stream.stream.clone())
            .collect())
    }

    fn message(&self, kind: &str, data: Value) -> Result<NerveMessage<Value>> {
        if self.state != SessionState::Ready {
            return Err(ClientError::Protocol("session is not ready".into()));
        }
        Ok(new_message(
            kind,
            self.source.clone(),
            self.accepting_peer.clone().expect("ready session has peer"),
            data,
        ))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{
        ClientSession, NerveMessage, PeerDescriptor, SessionState, StreamCursor, new_message,
    };

    #[test]
    fn handshake_and_batch_gap() {
        let source = PeerDescriptor {
            role: "ui".into(),
            id: Some("client_1".into()),
            name: Some("test".into()),
            instance_id: Some("instance_1".into()),
        };
        let mut session = ClientSession::new(
            source.clone(),
            [StreamCursor {
                stream: "workspace".into(),
                processed_seq: 4,
            }],
        );
        session.hello().unwrap();
        let server = PeerDescriptor {
            role: "workbench_server".into(),
            id: Some("server_1".into()),
            name: None,
            instance_id: None,
        };
        let welcome: NerveMessage<_> = new_message(
            "welcome",
            server.clone(),
            source,
            json!({
                "sessionId": "session_1", "acceptingPeer": server, "acceptedVersion": 1,
                "capabilities": crate::session::CAPABILITIES, "encoding": "json",
                "limits": { "maxMessageBytes": 1000, "maxBatchEvents": 10, "maxBatchBytes": 1000 },
                "heartbeat": { "intervalMs": 1000, "timeoutMs": 3000 }
            }),
        );
        session.accept_welcome(&welcome).unwrap();
        assert_eq!(session.state(), SessionState::Ready);
        assert_eq!(
            session.subscription().unwrap().kind,
            "stream.subscription.set"
        );
    }
}
