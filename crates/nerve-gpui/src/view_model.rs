use nerve_client::{ConnectionState, ConversationEntry, ConversationRecord, ProjectRecord};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SidebarItem {
    Project { id: String, name: String },
    Conversation(ConversationRow),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConversationRow {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub is_active: bool,
    pub is_selected: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TranscriptRow {
    pub id: String,
    pub role: String,
    pub kind: String,
    pub text: String,
    pub created_at: String,
}

impl TranscriptRow {
    pub fn from_entry(entry: &ConversationEntry) -> Self {
        let text = if entry.text.trim().is_empty() {
            entry.summary.clone().unwrap_or_default()
        } else {
            entry.text.clone()
        };
        Self {
            id: entry.id.clone(),
            role: entry.role.clone(),
            kind: entry.kind.clone(),
            text,
            created_at: entry.created_at.clone(),
        }
    }
}

pub fn sidebar_items(
    projects: &[ProjectRecord],
    conversations: &[ConversationRecord],
    selected_id: Option<&str>,
) -> Vec<SidebarItem> {
    let mut items = Vec::new();
    for project in projects {
        items.push(SidebarItem::Project {
            id: project.id.clone(),
            name: project.name.clone(),
        });
        items.extend(
            conversations
                .iter()
                .filter(|conversation| conversation.project_id == project.id)
                .map(|conversation| {
                    SidebarItem::Conversation(ConversationRow {
                        id: conversation.id.clone(),
                        project_id: conversation.project_id.clone(),
                        title: if conversation.title.trim().is_empty() {
                            "Untitled conversation".into()
                        } else {
                            conversation.title.clone()
                        },
                        is_active: conversation.active_entry_id.is_some(),
                        is_selected: selected_id == Some(conversation.id.as_str()),
                    })
                }),
        );
    }
    items
}

pub fn connection_label(state: Option<ConnectionState>) -> (&'static str, bool) {
    match state {
        Some(ConnectionState::Live) => ("Connected", true),
        Some(ConnectionState::Reconnecting) => ("Reconnecting", false),
        Some(ConnectionState::Closed) => ("Closed", false),
        Some(ConnectionState::Connecting) | None => ("Connecting", false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidebar_groups_conversations_and_marks_selection() {
        let projects = vec![ProjectRecord {
            id: "project".into(),
            name: "Nerve".into(),
            dir: "/tmp/nerve".into(),
            created_at: "now".into(),
            updated_at: "now".into(),
        }];
        let conversations = vec![ConversationRecord {
            id: "conversation".into(),
            project_id: "project".into(),
            title: "".into(),
            mode: "coding".into(),
            permission_level: "standard".into(),
            active_agent_id: None,
            active_entry_id: Some("entry".into()),
            created_at: "now".into(),
            updated_at: "now".into(),
            last_user_message_at: None,
        }];
        let items = sidebar_items(&projects, &conversations, Some("conversation"));
        assert_eq!(items.len(), 2);
        let SidebarItem::Conversation(row) = &items[1] else {
            panic!("conversation row")
        };
        assert_eq!(row.title, "Untitled conversation");
        assert!(row.is_selected && row.is_active);
    }

    #[test]
    fn transcript_uses_summary_for_empty_text() {
        let row = TranscriptRow::from_entry(&ConversationEntry {
            id: "entry".into(),
            conversation_id: "conversation".into(),
            role: "assistant".into(),
            kind: "message".into(),
            text: "".into(),
            summary: Some("Summary".into()),
            created_at: "now".into(),
        });
        assert_eq!(row.text, "Summary");
    }
}
