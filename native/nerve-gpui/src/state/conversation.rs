use anyhow::{Context as _, Result};
use serde::Deserialize;
use serde_json::Value;

use crate::protocol::messages::StreamCursor;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscriptEntry {
    pub(crate) id: String,
    pub(crate) role: String,
    #[serde(default = "default_kind")]
    pub(crate) kind: String,
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) created_at: String,
}

fn default_kind() -> String {
    "message".into()
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ConversationState {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) entries: Vec<TranscriptEntry>,
    pub(crate) live_text: String,
    pub(crate) cursor: u64,
}

#[derive(Deserialize)]
struct ConversationResult {
    snapshot: Snapshot,
    cursor: SnapshotCursor,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    conversation: ConversationHeader,
    entries: Vec<TranscriptEntry>,
    cursor_seq: u64,
}

#[derive(Deserialize)]
struct ConversationHeader {
    id: String,
    title: String,
}

#[derive(Deserialize)]
struct SnapshotCursor {
    streams: Vec<StreamCursor>,
}

impl ConversationState {
    pub(crate) fn from_snapshot_result(result: Value) -> Result<(Self, Vec<StreamCursor>)> {
        let result: ConversationResult =
            serde_json::from_value(result).context("decode conversation snapshot")?;
        Ok((
            Self {
                id: result.snapshot.conversation.id,
                title: result.snapshot.conversation.title,
                entries: result.snapshot.entries,
                live_text: String::new(),
                cursor: result.snapshot.cursor_seq,
            },
            result.cursor.streams,
        ))
    }

    pub(crate) fn apply_event(&mut self, event_type: &str, data: &Value, seq: u64) -> Result<()> {
        match event_type {
            "conversation.entry.appended" => {
                let entry: TranscriptEntry = serde_json::from_value(
                    data.get("entry")
                        .cloned()
                        .context("entry event missing entry")?,
                )?;
                if let Some(index) = self.entries.iter().position(|value| value.id == entry.id) {
                    self.entries[index] = entry;
                } else {
                    self.entries.push(entry);
                }
                self.live_text.clear();
            }
            "conversation.live.content.delta" => {
                if let Some(text) = data
                    .get("delta")
                    .or_else(|| data.get("text"))
                    .and_then(Value::as_str)
                {
                    self.live_text.push_str(text);
                }
            }
            _ => {}
        }
        self.cursor = seq;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconciles_live_text_when_durable_entry_arrives() {
        let mut state = ConversationState {
            id: "conv_test".into(),
            ..Default::default()
        };
        state
            .apply_event(
                "conversation.live.content.delta",
                &serde_json::json!({ "delta": "hello" }),
                1,
            )
            .unwrap();
        assert_eq!(state.live_text, "hello");
        state.apply_event(
            "conversation.entry.appended",
            &serde_json::json!({
                "entry": { "id": "entry_1", "role": "assistant", "text": "hello", "createdAt": "2026-01-01T00:00:00.000Z" }
            }),
            2,
        ).unwrap();
        assert!(state.live_text.is_empty());
        assert_eq!(state.entries.len(), 1);
        assert_eq!(state.cursor, 2);
    }
}
