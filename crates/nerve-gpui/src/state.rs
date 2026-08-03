use nerve_client::{ConnectionState, ConversationEntry, ConversationRecord, ProjectRecord};

use crate::view_model::{SidebarItem, TranscriptRow, sidebar_items};

#[derive(Default)]
pub struct WorkbenchState {
    pub connection: Option<ConnectionState>,
    pub projects: Vec<ProjectRecord>,
    pub conversations: Vec<ConversationRecord>,
    pub selected_conversation_id: Option<String>,
    pub entries: Vec<ConversationEntry>,
    pub error: Option<String>,
    pub loading_workspace: bool,
    pub loading_conversation: bool,
    pub sidebar_visible: bool,
}

impl WorkbenchState {
    pub fn initial() -> Self {
        Self {
            loading_workspace: true,
            sidebar_visible: true,
            ..Self::default()
        }
    }

    pub fn sidebar_items(&self) -> Vec<SidebarItem> {
        sidebar_items(
            &self.projects,
            &self.conversations,
            self.selected_conversation_id.as_deref(),
        )
    }

    pub fn transcript_rows(&self) -> Vec<TranscriptRow> {
        self.entries.iter().map(TranscriptRow::from_entry).collect()
    }

    pub fn selected_conversation(&self) -> Option<&ConversationRecord> {
        let id = self.selected_conversation_id.as_deref()?;
        self.conversations.iter().find(|item| item.id == id)
    }

    pub fn selected_project(&self) -> Option<&ProjectRecord> {
        let project_id = self.selected_conversation()?.project_id.as_str();
        self.projects
            .iter()
            .find(|project| project.id == project_id)
    }

    pub fn select_relative(&self, offset: isize) -> Option<String> {
        if self.conversations.is_empty() {
            return None;
        }
        let current = self
            .selected_conversation_id
            .as_deref()
            .and_then(|id| self.conversations.iter().position(|item| item.id == id))
            .unwrap_or(0);
        let next = (current as isize + offset).clamp(0, self.conversations.len() as isize - 1);
        Some(self.conversations[next as usize].id.clone())
    }
}
