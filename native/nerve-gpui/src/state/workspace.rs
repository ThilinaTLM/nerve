use anyhow::{Context as _, Result};
use serde::Deserialize;
use serde_json::Value;

use crate::protocol::messages::StreamCursor;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Project {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) dir: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Conversation {
    pub(crate) id: String,
    pub(crate) project_id: String,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) active_agent_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct WorkspaceState {
    pub(crate) projects: Vec<Project>,
    pub(crate) conversations: Vec<Conversation>,
    pub(crate) cursor: u64,
}

#[derive(Deserialize)]
struct WorkspaceResult {
    snapshot: WorkspaceSnapshot,
    cursor: SnapshotCursor,
}

#[derive(Deserialize)]
struct WorkspaceSnapshot {
    projects: Vec<Project>,
    conversations: Vec<Conversation>,
}

#[derive(Deserialize)]
struct SnapshotCursor {
    streams: Vec<StreamCursor>,
}

impl WorkspaceState {
    pub(crate) fn conversations_for_project(
        &self,
        project_id: &str,
    ) -> impl Iterator<Item = &Conversation> {
        self.conversations
            .iter()
            .filter(move |conversation| conversation.project_id == project_id)
    }

    pub(crate) fn upsert_conversation(&mut self, conversation: Conversation) {
        upsert(&mut self.conversations, conversation, |value| &value.id);
    }

    pub(crate) fn from_snapshot_result(result: Value) -> Result<(Self, Vec<StreamCursor>)> {
        let result: WorkspaceResult =
            serde_json::from_value(result).context("decode workspace snapshot")?;
        let cursor = result
            .cursor
            .streams
            .iter()
            .find(|stream| stream.stream == "workspace")
            .map_or(0, |stream| stream.processed_seq);
        Ok((
            Self {
                projects: result.snapshot.projects,
                conversations: result.snapshot.conversations,
                cursor,
            },
            result.cursor.streams,
        ))
    }

    pub(crate) fn apply_event(&mut self, event_type: &str, data: &Value, seq: u64) -> Result<()> {
        match event_type {
            "project.created" | "project.updated" => {
                let project: Project = serde_json::from_value(
                    data.get("project").cloned().unwrap_or_else(|| data.clone()),
                )?;
                upsert(&mut self.projects, project, |value| &value.id);
            }
            "project.deleted" => {
                if let Some(id) = data.get("projectId").and_then(Value::as_str) {
                    self.projects.retain(|project| project.id != id);
                    self.conversations
                        .retain(|conversation| conversation.project_id != id);
                }
            }
            "conversation.created" | "conversation.updated" => {
                let conversation: Conversation = serde_json::from_value(
                    data.get("conversation")
                        .cloned()
                        .unwrap_or_else(|| data.clone()),
                )?;
                upsert(&mut self.conversations, conversation, |value| &value.id);
            }
            "conversation.deleted" => {
                if let Some(id) = data.get("conversationId").and_then(Value::as_str) {
                    self.conversations
                        .retain(|conversation| conversation.id != id);
                }
            }
            _ => {}
        }
        self.cursor = seq;
        Ok(())
    }
}

fn upsert<T, F>(values: &mut Vec<T>, replacement: T, id: F)
where
    F: Fn(&T) -> &str,
{
    if let Some(index) = values
        .iter()
        .position(|value| id(value) == id(&replacement))
    {
        values[index] = replacement;
    } else {
        values.push(replacement);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_unknown_events_and_advances_cursor() {
        let mut state = WorkspaceState::default();
        state
            .apply_event("future.event", &serde_json::json!({ "kept": true }), 8)
            .unwrap();
        assert_eq!(state.cursor, 8);
    }
}
