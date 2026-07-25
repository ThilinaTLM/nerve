use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PeerRole {
    WorkbenchServer,
    Ui,
    DesktopShell,
    Cli,
    SandboxManager,
    SandboxAgent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PeerDescriptor {
    pub(crate) role: PeerRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) instance_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Envelope {
    pub(crate) protocol: String,
    pub(crate) version: u8,
    pub(crate) id: String,
    pub(crate) ts: DateTime<Utc>,
    pub(crate) source: PeerDescriptor,
    pub(crate) target: PeerDescriptor,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) correlation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) causation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reply_to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) meta: Option<serde_json::Map<String, Value>>,
}

impl Envelope {
    pub(crate) fn ui(kind_id: String) -> Self {
        Self {
            protocol: "nerve".into(),
            version: 1,
            id: kind_id,
            ts: Utc::now(),
            source: PeerDescriptor {
                role: PeerRole::Ui,
                id: Some(format!("native_{}", uuid::Uuid::new_v4())),
                name: Some("Nerve Native Evaluation".into()),
                instance_id: Some(uuid::Uuid::new_v4().to_string()),
            },
            target: PeerDescriptor {
                role: PeerRole::WorkbenchServer,
                id: None,
                name: None,
                instance_id: None,
            },
            correlation_id: None,
            causation_id: None,
            trace_id: None,
            reply_to: None,
            meta: None,
        }
    }
}
