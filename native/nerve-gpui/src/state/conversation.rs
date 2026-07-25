use anyhow::{Context as _, Result, bail};
use serde::Deserialize;
use serde_json::Value;

use crate::protocol::messages::StreamCursor;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TranscriptEntry {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    #[serde(default)]
    pub(crate) agent_id: Option<String>,
    #[serde(default)]
    pub(crate) run_id: Option<String>,
    #[serde(default)]
    pub(crate) turn_id: Option<String>,
    #[serde(default)]
    pub(crate) live_message_id: Option<String>,
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

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum LiveBlockKind {
    Text,
    Thinking,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveBlock {
    pub(crate) kind: LiveBlockKind,
    pub(crate) content_block_id: String,
    pub(crate) content_index: u64,
    #[serde(default)]
    pub(crate) live_message_id: String,
    #[serde(default)]
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) done: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ConversationState {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) active_agent_id: Option<String>,
    pub(crate) entries: Vec<TranscriptEntry>,
    pub(crate) live_blocks: Vec<LiveBlock>,
    pub(crate) running: bool,
    pub(crate) run_status: Option<String>,
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
    #[serde(default)]
    active_run: Option<ActiveRun>,
    cursor_seq: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConversationHeader {
    id: String,
    title: String,
    #[serde(default)]
    active_agent_id: Option<String>,
}

#[derive(Deserialize)]
struct ActiveRun {
    turns: Vec<LiveTurn>,
}

#[derive(Deserialize)]
struct LiveTurn {
    messages: Vec<LiveMessage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveMessage {
    live_message_id: String,
    blocks: Vec<SnapshotBlock>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum SnapshotBlock {
    Text {
        #[serde(rename = "contentBlockId")]
        content_block_id: String,
        #[serde(rename = "contentIndex")]
        content_index: u64,
        text: String,
        done: bool,
    },
    Thinking {
        #[serde(rename = "contentBlockId")]
        content_block_id: String,
        #[serde(rename = "contentIndex")]
        content_index: u64,
        text: String,
        done: bool,
    },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct SnapshotCursor {
    streams: Vec<StreamCursor>,
}

impl ConversationState {
    pub(crate) fn from_snapshot_result(result: Value) -> Result<(Self, Vec<StreamCursor>)> {
        let result: ConversationResult =
            serde_json::from_value(result).context("decode conversation snapshot")?;
        let mut live_blocks = Vec::new();
        let has_active_run = result.snapshot.active_run.is_some();
        if let Some(active_run) = result.snapshot.active_run {
            for turn in active_run.turns {
                for message in turn.messages {
                    for block in message.blocks {
                        let block = match block {
                            SnapshotBlock::Text {
                                content_block_id,
                                content_index,
                                text,
                                done,
                            } => Some(LiveBlock {
                                kind: LiveBlockKind::Text,
                                content_block_id,
                                content_index,
                                live_message_id: message.live_message_id.clone(),
                                text,
                                done,
                            }),
                            SnapshotBlock::Thinking {
                                content_block_id,
                                content_index,
                                text,
                                done,
                            } => Some(LiveBlock {
                                kind: LiveBlockKind::Thinking,
                                content_block_id,
                                content_index,
                                live_message_id: message.live_message_id.clone(),
                                text,
                                done,
                            }),
                            SnapshotBlock::Other => None,
                        };
                        if let Some(block) = block {
                            live_blocks.push(block);
                        }
                    }
                }
            }
        }
        Ok((
            Self {
                id: result.snapshot.conversation.id,
                title: result.snapshot.conversation.title,
                active_agent_id: result.snapshot.conversation.active_agent_id,
                entries: result.snapshot.entries,
                live_blocks,
                running: has_active_run,
                run_status: has_active_run.then(|| "Running".to_owned()),
                cursor: result.snapshot.cursor_seq,
            },
            result.cursor.streams,
        ))
    }

    #[allow(
        clippy::too_many_lines,
        reason = "the reducer keeps the small supported event surface in one auditable match"
    )]
    pub(crate) fn apply_event(&mut self, event_type: &str, data: &Value, seq: u64) -> Result<()> {
        match event_type {
            "conversation.entry.appended" => {
                let entry: TranscriptEntry = serde_json::from_value(
                    data.get("entry")
                        .cloned()
                        .context("entry event missing entry")?,
                )?;
                if let Some(index) = self.entries.iter().position(|value| value.id == entry.id) {
                    self.entries[index] = entry.clone();
                } else {
                    self.entries.push(entry.clone());
                }
                if let Some(live_message_id) = &entry.live_message_id {
                    self.live_blocks
                        .retain(|block| &block.live_message_id != live_message_id);
                }
            }
            "conversation.live.content.delta" => {
                let block_id = string_field(data, "contentBlockId")?;
                let kind = match string_field(data, "kind")?.as_str() {
                    "text" => LiveBlockKind::Text,
                    "thinking" => LiveBlockKind::Thinking,
                    other => bail!("unknown live block kind {other}"),
                };
                let offset =
                    usize::try_from(data.get("offset").and_then(Value::as_u64).unwrap_or(0))
                        .context("live content offset exceeds this platform's address space")?;
                let delta = string_field(data, "delta")?;
                let live_message_id = string_field(data, "liveMessageId")?;
                let content_index = data
                    .get("contentIndex")
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                if let Some(block) = self
                    .live_blocks
                    .iter_mut()
                    .find(|block| block.content_block_id == block_id)
                {
                    let current_offset = block.text.encode_utf16().count();
                    if current_offset != offset {
                        bail!(
                            "live content offset mismatch for {block_id}: expected {current_offset}, received {offset}"
                        );
                    }
                    block.text.push_str(&delta);
                } else {
                    if offset != 0 {
                        bail!("new live content block {block_id} started at offset {offset}");
                    }
                    self.live_blocks.push(LiveBlock {
                        kind,
                        content_block_id: block_id,
                        content_index,
                        live_message_id,
                        text: delta,
                        done: false,
                    });
                }
            }
            "conversation.live.content.done" => {
                let block_id = string_field(data, "contentBlockId")?;
                if let Some(block) = self
                    .live_blocks
                    .iter_mut()
                    .find(|block| block.content_block_id == block_id)
                {
                    if let Some(final_text) = data.get("finalText").and_then(Value::as_str) {
                        final_text.clone_into(&mut block.text);
                    }
                    block.done = true;
                }
            }
            "run.started" | "run.resumed" => {
                self.running = true;
                self.run_status = Some("Running".into());
            }
            "run.retrying" => {
                self.running = true;
                self.run_status = Some("Retrying".into());
            }
            "run.suspended" => {
                self.running = true;
                self.run_status = Some("Waiting for interaction in the Web UI".into());
            }
            "run.completed" => {
                self.running = false;
                self.run_status = Some("Completed".into());
            }
            "run.cancelled" => {
                self.running = false;
                self.run_status = Some("Cancelled".into());
            }
            "run.failed" => {
                self.running = false;
                self.run_status = Some(
                    data.get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Run failed")
                        .to_owned(),
                );
            }
            _ => {}
        }
        self.cursor = seq;
        Ok(())
    }
}

fn string_field(data: &Value, name: &str) -> Result<String> {
    data.get(name)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .with_context(|| format!("event missing {name}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> Value {
        serde_json::json!({
            "id": "entry_1",
            "conversationId": "conv_test",
            "agentId": "agent_test",
            "runId": "run_test",
            "liveMessageId": "msg_live",
            "role": "assistant",
            "kind": "message",
            "text": "hello",
            "createdAt": "2026-01-01T00:00:00.000Z"
        })
    }

    #[test]
    fn reconciles_live_text_when_durable_entry_arrives() {
        let mut state = ConversationState {
            id: "conv_test".into(),
            ..Default::default()
        };
        state
            .apply_event(
                "conversation.live.content.delta",
                &serde_json::json!({
                    "contentBlockId": "block_1",
                    "contentIndex": 0,
                    "liveMessageId": "msg_live",
                    "kind": "text",
                    "offset": 0,
                    "delta": "hello"
                }),
                1,
            )
            .unwrap();
        assert_eq!(state.live_blocks[0].text, "hello");
        state
            .apply_event(
                "conversation.entry.appended",
                &serde_json::json!({ "entry": entry() }),
                2,
            )
            .unwrap();
        assert!(state.live_blocks.is_empty());
        assert_eq!(state.entries.len(), 1);
        assert_eq!(state.cursor, 2);
    }

    #[test]
    fn hydrates_active_run_text_from_snapshot() {
        let (state, cursors) = ConversationState::from_snapshot_result(serde_json::json!({
            "snapshot": {
                "conversation": {
                    "id": "conv_test",
                    "title": "Live",
                    "activeAgentId": "agent_test"
                },
                "entries": [],
                "activeRun": {
                    "turns": [{
                        "messages": [{
                            "liveMessageId": "msg_live",
                            "blocks": [{
                                "kind": "text",
                                "contentBlockId": "block_1",
                                "contentIndex": 0,
                                "text": "in progress",
                                "done": false
                            }]
                        }]
                    }]
                },
                "cursorSeq": 7
            },
            "cursor": {
                "streams": [{ "stream": "conv/conv_test", "processedSeq": 7 }]
            }
        }))
        .unwrap();
        assert!(state.running);
        assert_eq!(state.active_agent_id.as_deref(), Some("agent_test"));
        assert_eq!(state.live_blocks[0].text, "in progress");
        assert_eq!(cursors[0].processed_seq, 7);
    }

    #[test]
    fn rejects_out_of_order_live_delta() {
        let mut state = ConversationState::default();
        assert!(
            state
                .apply_event(
                    "conversation.live.content.delta",
                    &serde_json::json!({
                        "contentBlockId": "block_1",
                        "contentIndex": 0,
                        "liveMessageId": "msg_live",
                        "kind": "text",
                        "offset": 4,
                        "delta": "bad"
                    }),
                    1,
                )
                .is_err()
        );
        assert_eq!(state.cursor, 0);
    }
}
