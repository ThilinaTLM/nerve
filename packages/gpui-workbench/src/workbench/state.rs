use chrono::Local;
use gpui::Context;

use super::{
    config::{ConnectionConfig, discover_connection_config},
    models::{
        ConversationRecord, ConversationSection, ProjectItem, WorkspaceSnapshotResponse,
        build_conversation_sections, build_project_items,
    },
    protocol::{WorkerEvent, WorkerHandle},
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ConnectionStatus {
    Connecting,
    Live,
    Retrying(String),
    Error(String),
    Closed,
}

impl ConnectionStatus {
    pub fn label(&self) -> &str {
        match self {
            Self::Connecting => "Connecting",
            Self::Live => "Live",
            Self::Retrying(_) => "Reconnecting",
            Self::Error(_) => "Connection error",
            Self::Closed => "Closed",
        }
    }

    pub fn detail(&self) -> Option<&str> {
        match self {
            Self::Retrying(message) | Self::Error(message) => Some(message),
            _ => None,
        }
    }
}

pub struct WorkbenchState {
    status: ConnectionStatus,
    target: Option<String>,
    user_home: Option<String>,
    projects: Vec<ProjectItem>,
    conversations: Vec<ConversationRecord>,
    selected_project_key: Option<String>,
    selected_conversation_id: Option<String>,
    worker: Option<WorkerHandle>,
}

impl WorkbenchState {
    pub fn new(cx: &mut Context<Self>) -> Self {
        let mut state = Self::disconnected();
        match discover_connection_config() {
            Ok(config) => state.connect(config, cx),
            Err(error) => state.status = ConnectionStatus::Error(error),
        }
        state
    }

    pub fn disconnected() -> Self {
        Self {
            status: ConnectionStatus::Closed,
            target: None,
            user_home: None,
            projects: Vec::new(),
            conversations: Vec::new(),
            selected_project_key: None,
            selected_conversation_id: None,
            worker: None,
        }
    }

    fn connect(&mut self, config: ConnectionConfig, cx: &mut Context<Self>) {
        self.status = ConnectionStatus::Connecting;
        self.target = Some(config.display_target());
        let (worker, events) = WorkerHandle::spawn(config);
        self.worker = Some(worker);
        cx.spawn(async move |state, cx| {
            while let Ok(event) = events.recv().await {
                let Some(state) = state.upgrade() else {
                    break;
                };
                if state
                    .update(cx, |state, cx| {
                        state.apply_worker_event(event);
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
    }

    fn apply_worker_event(&mut self, event: WorkerEvent) {
        match event {
            WorkerEvent::Connecting { target } => {
                self.target = Some(target);
                self.status = ConnectionStatus::Connecting;
            }
            WorkerEvent::Retrying { target, message } => {
                self.target = Some(target);
                self.status = ConnectionStatus::Retrying(message);
            }
            WorkerEvent::Live { target } => {
                self.target = Some(target);
                self.status = ConnectionStatus::Live;
            }
            WorkerEvent::Snapshot {
                user_home,
                snapshot,
            } => self.apply_snapshot(user_home, snapshot),
            WorkerEvent::Error { target, message } => {
                self.target = Some(target);
                self.status = ConnectionStatus::Error(message);
            }
            WorkerEvent::Closed => self.status = ConnectionStatus::Closed,
        }
    }

    pub(crate) fn apply_snapshot(
        &mut self,
        user_home: String,
        snapshot: WorkspaceSnapshotResponse,
    ) {
        let project_items = build_project_items(
            &snapshot.snapshot.projects,
            &snapshot.snapshot.conversations,
            Some(&user_home),
        );
        let selected_key = self
            .selected_project_key
            .as_ref()
            .filter(|key| project_items.iter().any(|project| &project.key == *key))
            .cloned()
            .or_else(|| project_items.first().map(|project| project.key.clone()));
        self.user_home = Some(user_home);
        self.projects = project_items;
        self.conversations = snapshot.snapshot.conversations;
        self.selected_project_key = selected_key;

        let selected_conversation_is_visible = self
            .selected_conversation_id
            .as_ref()
            .is_some_and(|id| self.visible_conversations().iter().any(|row| &row.id == id));
        if !selected_conversation_is_visible {
            self.selected_conversation_id = None;
        }
    }

    pub fn status(&self) -> &ConnectionStatus {
        &self.status
    }

    pub fn target(&self) -> Option<&str> {
        self.target.as_deref()
    }

    pub fn projects(&self) -> &[ProjectItem] {
        &self.projects
    }

    pub fn active_project(&self) -> Option<&ProjectItem> {
        let key = self.selected_project_key.as_deref()?;
        self.projects.iter().find(|project| project.key == key)
    }

    pub fn selected_project_key(&self) -> Option<&str> {
        self.selected_project_key.as_deref()
    }

    pub fn selected_conversation_id(&self) -> Option<&str> {
        self.selected_conversation_id.as_deref()
    }

    pub fn conversation_count(&self) -> usize {
        self.visible_conversations().len()
    }

    pub fn conversation_sections(&self) -> Vec<ConversationSection> {
        let Some(project) = self.active_project() else {
            return Vec::new();
        };
        build_conversation_sections(&self.conversations, &project.project_ids, Local::now())
    }

    fn visible_conversations(&self) -> Vec<&ConversationRecord> {
        let Some(project) = self.active_project() else {
            return Vec::new();
        };
        self.conversations
            .iter()
            .filter(|conversation| project.project_ids.contains(&conversation.project_id))
            .collect()
    }

    pub fn select_project(&mut self, key: &str) {
        if self.selected_project_key.as_deref() == Some(key) {
            return;
        }
        if self.projects.iter().any(|project| project.key == key) {
            self.selected_project_key = Some(key.to_string());
            self.selected_conversation_id = None;
        }
    }

    pub fn select_conversation(&mut self, id: &str) {
        if self.visible_conversations().iter().any(|row| row.id == id) {
            self.selected_conversation_id = Some(id.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workbench::models::{
        ConversationRecord, ProjectRecord, SnapshotCursor, StreamCursor, WorkspaceSnapshot,
    };

    fn snapshot() -> WorkspaceSnapshotResponse {
        WorkspaceSnapshotResponse {
            snapshot: WorkspaceSnapshot {
                projects: vec![
                    ProjectRecord {
                        id: "proj_a".to_string(),
                        name: "a".to_string(),
                        dir: "/work/a".to_string(),
                        created_at: "2026-01-01T00:00:00Z".to_string(),
                        updated_at: "2026-01-02T00:00:00Z".to_string(),
                    },
                    ProjectRecord {
                        id: "proj_b".to_string(),
                        name: "b".to_string(),
                        dir: "/work/b".to_string(),
                        created_at: "2026-01-01T00:00:00Z".to_string(),
                        updated_at: "2026-01-01T00:00:00Z".to_string(),
                    },
                ],
                conversations: vec![ConversationRecord {
                    id: "conv_a".to_string(),
                    project_id: "proj_a".to_string(),
                    title: "Conversation A".to_string(),
                    created_at: "2026-01-03T00:00:00Z".to_string(),
                    updated_at: "2026-01-03T00:00:00Z".to_string(),
                    last_user_message_at: None,
                    pinned: false,
                    completed_at: None,
                }],
            },
            cursor: SnapshotCursor {
                streams: vec![StreamCursor {
                    stream: "workspace".to_string(),
                    processed_seq: 1,
                }],
            },
        }
    }

    #[test]
    fn snapshot_selects_fallback_and_project_change_clears_conversation() {
        let mut state = WorkbenchState::disconnected();
        state.apply_snapshot("/home/test".to_string(), snapshot());
        assert_eq!(state.selected_project_key(), Some("/work/a"));
        assert_eq!(state.conversation_count(), 1);

        state.select_conversation("conv_a");
        assert_eq!(state.selected_conversation_id(), Some("conv_a"));
        state.select_project("/work/b");
        assert_eq!(state.selected_conversation_id(), None);
        assert_eq!(state.conversation_count(), 0);
    }

    #[test]
    fn snapshot_preserves_valid_selection() {
        let mut state = WorkbenchState::disconnected();
        state.apply_snapshot("/home/test".to_string(), snapshot());
        state.select_project("/work/b");
        state.apply_snapshot("/home/test".to_string(), snapshot());
        assert_eq!(state.selected_project_key(), Some("/work/b"));
    }
}
