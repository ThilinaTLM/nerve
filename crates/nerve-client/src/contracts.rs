use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PeerDescriptor {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instance_id: Option<String>,
}

impl PeerDescriptor {
    pub fn server() -> Self {
        Self {
            role: "workbench_server".into(),
            id: None,
            name: None,
            instance_id: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NerveMessage<T = Value> {
    pub protocol: String,
    pub version: u8,
    pub id: String,
    pub kind: String,
    pub ts: String,
    pub source: PeerDescriptor,
    pub target: PeerDescriptor,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub causation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta: Option<BTreeMap<String, Value>>,
    pub data: T,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelloData {
    pub requested_version: u8,
    pub capabilities: Vec<String>,
    pub required_capabilities: Vec<String>,
    pub encodings: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolLimits {
    pub max_message_bytes: usize,
    pub max_batch_events: usize,
    pub max_batch_bytes: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatConfig {
    pub interval_ms: u64,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WelcomeData {
    pub session_id: String,
    pub accepting_peer: PeerDescriptor,
    pub accepted_version: u8,
    pub capabilities: Vec<String>,
    pub encoding: String,
    pub limits: ProtocolLimits,
    pub heartbeat: HeartbeatConfig,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamCursor {
    pub stream: String,
    pub processed_seq: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribedStreamState {
    pub stream: String,
    pub latest_seq: u64,
    pub earliest_available_seq: u64,
    pub mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionUpdatedData {
    pub session_id: String,
    pub subscription_id: String,
    pub accepted: bool,
    pub streams: Vec<SubscribedStreamState>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EventEnvelope {
    pub id: String,
    pub seq: u64,
    #[serde(rename = "type")]
    pub event_type: String,
    pub ts: String,
    pub data: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBatchData {
    pub stream: String,
    pub batch_id: String,
    pub reason: String,
    pub events: Vec<EventEnvelope>,
    pub first_seq: Option<u64>,
    pub last_seq: Option<u64>,
}

impl EventBatchData {
    pub fn validate_dense(&self) -> std::result::Result<(), String> {
        if self.events.is_empty() {
            return if self.first_seq.is_none() && self.last_seq.is_none() {
                Ok(())
            } else {
                Err("empty event batch has sequence bounds".into())
            };
        }
        let first = self.events.first().expect("non-empty").seq;
        let last = self.events.last().expect("non-empty").seq;
        if self.first_seq != Some(first) || self.last_seq != Some(last) {
            return Err("event batch bounds do not match events".into());
        }
        if self
            .events
            .windows(2)
            .any(|pair| pair[1].seq != pair[0].seq + 1)
        {
            return Err("event batch is not dense".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCursor {
    pub streams: Vec<StreamCursor>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResponse<T> {
    pub snapshot: T,
    pub cursor: SnapshotCursor,
    pub generated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub dir: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub mode: String,
    pub permission_level: String,
    pub active_agent_id: Option<String>,
    pub active_entry_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_user_message_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationEntry {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    #[serde(default = "default_entry_kind")]
    pub kind: String,
    pub text: String,
    pub summary: Option<String>,
    pub created_at: String,
}

fn default_entry_kind() -> String {
    "message".into()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub projects: Vec<ProjectRecord>,
    pub conversations: Vec<ConversationRecord>,
    #[serde(default)]
    pub agents: Vec<Value>,
    #[serde(default)]
    pub tasks: Vec<Value>,
    #[serde(default)]
    pub approvals: Vec<Value>,
    #[serde(default)]
    pub user_questions: Vec<Value>,
    #[serde(default)]
    pub plan_reviews: Vec<Value>,
    #[serde(default)]
    pub workers: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSnapshot {
    pub conversation: ConversationRecord,
    pub entries: Vec<ConversationEntry>,
    pub active_entry_ids: Vec<String>,
    pub tree: Value,
    pub tool_calls: Vec<Value>,
    pub cursor_seq: u64,
    pub generated_at: String,
}

#[cfg(test)]
mod tests {
    use super::{EventBatchData, EventEnvelope};
    use serde_json::Value;

    #[test]
    fn validates_dense_batches() {
        let event = |seq| EventEnvelope {
            id: format!("evt_{seq}"),
            seq,
            event_type: "project.updated".into(),
            ts: "2026-01-01T00:00:00Z".into(),
            data: Value::Null,
        };
        let dense = EventBatchData {
            stream: "workspace".into(),
            batch_id: "batch_1".into(),
            reason: "live".into(),
            events: vec![event(1), event(2)],
            first_seq: Some(1),
            last_seq: Some(2),
        };
        assert!(dense.validate_dense().is_ok());
        let gap = EventBatchData {
            events: vec![event(1), event(3)],
            last_seq: Some(3),
            ..dense
        };
        assert!(gap.validate_dense().is_err());
    }
}
