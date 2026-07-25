use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::envelope::{Envelope, PeerDescriptor};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StreamCursor {
    pub(crate) stream: String,
    pub(crate) processed_seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HelloData {
    pub(crate) requested_version: u8,
    pub(crate) capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) required_capabilities: Option<Vec<String>>,
    pub(crate) encodings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) preferences: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WelcomeData {
    pub(crate) session_id: String,
    pub(crate) accepting_peer: PeerDescriptor,
    pub(crate) accepted_version: u8,
    pub(crate) capabilities: Vec<String>,
    pub(crate) encoding: String,
    pub(crate) limits: ProtocolLimits,
    pub(crate) heartbeat: HeartbeatPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(
    clippy::struct_field_names,
    reason = "field names intentionally mirror the transport contract"
)]
pub(crate) struct ProtocolLimits {
    pub(crate) max_message_bytes: u64,
    pub(crate) max_batch_events: u64,
    pub(crate) max_batch_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HeartbeatPolicy {
    pub(crate) interval_ms: u64,
    pub(crate) timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadyData {
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HeartbeatData {
    pub(crate) session_id: String,
    pub(crate) sent_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RequestData {
    pub(crate) method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) params: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) idempotency_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) timeout_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) expect: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ResponseData {
    pub(crate) ok: bool,
    pub(crate) method: String,
    pub(crate) result: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cursor: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) event_batches: Option<Vec<EventBatchData>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProtocolErrorData {
    pub(crate) code: String,
    pub(crate) message: String,
    pub(crate) retryable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) close: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) details: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) recovery: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EventEnvelope {
    pub(crate) seq: u64,
    pub(crate) id: String,
    pub(crate) ts: String,
    #[serde(rename = "type")]
    pub(crate) event_type: String,
    pub(crate) data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EventBatchData {
    pub(crate) stream: String,
    pub(crate) batch_id: String,
    pub(crate) reason: String,
    pub(crate) events: Vec<EventEnvelope>,
    pub(crate) first_seq: Option<u64>,
    pub(crate) last_seq: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct NotifyEvent {
    pub(crate) id: String,
    pub(crate) ts: String,
    #[serde(rename = "type")]
    pub(crate) event_type: String,
    pub(crate) data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EventNotifyData {
    pub(crate) events: Vec<NotifyEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SubscriptionSetData {
    pub(crate) session_id: String,
    pub(crate) subscription_id: String,
    pub(crate) streams: Vec<StreamCursor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StreamState {
    pub(crate) stream: String,
    pub(crate) latest_seq: u64,
    pub(crate) earliest_available_seq: u64,
    pub(crate) mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SubscriptionUpdatedData {
    pub(crate) session_id: String,
    pub(crate) subscription_id: String,
    pub(crate) accepted: bool,
    pub(crate) streams: Vec<StreamState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub(crate) enum WireMessage {
    #[serde(rename = "hello")]
    Hello {
        #[serde(flatten)]
        envelope: Envelope,
        data: HelloData,
    },
    #[serde(rename = "welcome")]
    Welcome {
        #[serde(flatten)]
        envelope: Envelope,
        data: WelcomeData,
    },
    #[serde(rename = "ready")]
    Ready {
        #[serde(flatten)]
        envelope: Envelope,
        data: ReadyData,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat {
        #[serde(flatten)]
        envelope: Envelope,
        data: HeartbeatData,
    },
    #[serde(rename = "request")]
    Request {
        #[serde(flatten)]
        envelope: Envelope,
        data: RequestData,
    },
    #[serde(rename = "response")]
    Response {
        #[serde(flatten)]
        envelope: Envelope,
        data: ResponseData,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(flatten)]
        envelope: Envelope,
        data: ProtocolErrorData,
    },
    #[serde(rename = "event.batch")]
    EventBatch {
        #[serde(flatten)]
        envelope: Envelope,
        data: EventBatchData,
    },
    #[serde(rename = "event.notify")]
    EventNotify {
        #[serde(flatten)]
        envelope: Envelope,
        data: EventNotifyData,
    },
    #[serde(rename = "stream.subscription.set")]
    SubscriptionSet {
        #[serde(flatten)]
        envelope: Envelope,
        data: SubscriptionSetData,
    },
    #[serde(rename = "stream.subscription.updated")]
    SubscriptionUpdated {
        #[serde(flatten)]
        envelope: Envelope,
        data: SubscriptionUpdatedData,
    },
    #[serde(other)]
    Unknown,
}

pub(crate) const CAPABILITIES: &[&str] = &[
    "encoding.json",
    "event.batch",
    "event.notify",
    "stream.subscription.v1",
    "snapshot.workspace",
    "operation.snapshot.workspace.get",
    "operation.snapshot.conversation.get",
    "operation.conversation.create",
    "operation.agent.create",
    "operation.run.start",
];

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Corpus {
        valid_messages: Vec<Value>,
        invalid_messages: Vec<InvalidFixture>,
    }

    #[derive(Deserialize)]
    struct InvalidFixture {
        input: Value,
    }

    fn corpus() -> Corpus {
        serde_json::from_str(include_str!(
            "../../../../packages/contracts/schemas/native-spike-v1.fixtures.json"
        ))
        .unwrap()
    }

    #[test]
    fn decodes_and_round_trips_contract_fixtures() {
        for input in corpus().valid_messages {
            let message: WireMessage = serde_json::from_value(input).unwrap();
            let encoded = serde_json::to_value(message).unwrap();
            assert_eq!(encoded["protocol"], "nerve");
            assert_eq!(encoded["version"], 1);
        }
    }

    #[test]
    fn rejects_contract_invalid_fixtures() {
        for fixture in corpus().invalid_messages {
            assert!(
                crate::protocol::client::ReadOnlyProtocolClient::decode(
                    &serde_json::to_string(&fixture.input).unwrap(),
                )
                .is_err()
            );
        }
    }
}
