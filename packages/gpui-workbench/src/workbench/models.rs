use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Local, NaiveDate};
use serde::Deserialize;

pub const MAX_LISTED_CONVERSATIONS: usize = 100;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub name: String,
    pub dir: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationRecord {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_user_message_at: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    pub completed_at: Option<String>,
}

impl ConversationRecord {
    pub fn sort_at(&self) -> &str {
        self.last_user_message_at
            .as_deref()
            .unwrap_or(&self.created_at)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientConfigResponse {
    pub ws_url: String,
    pub status: ClientStatus,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ClientStatus {
    pub storage: ClientStorageStatus,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStorageStatus {
    pub user_home: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotResponse {
    pub snapshot: WorkspaceSnapshot,
    pub cursor: SnapshotCursor,
}

#[derive(Clone, Debug, Deserialize)]
pub struct WorkspaceSnapshot {
    pub projects: Vec<ProjectRecord>,
    pub conversations: Vec<ConversationRecord>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct SnapshotCursor {
    pub streams: Vec<StreamCursor>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamCursor {
    pub stream: String,
    pub processed_seq: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectItem {
    pub key: String,
    pub project_id: String,
    pub project_ids: Vec<String>,
    pub label: String,
    pub dir: String,
    pub conversation_count: usize,
    pub sort_at: String,
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum ConversationSectionKind {
    Pinned,
    Today,
    Yesterday,
    PreviousSevenDays,
    Older,
}

impl ConversationSectionKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Pinned => "Pinned",
            Self::Today => "Today",
            Self::Yesterday => "Yesterday",
            Self::PreviousSevenDays => "Previous 7 days",
            Self::Older => "Older",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationSection {
    pub kind: ConversationSectionKind,
    pub rows: Vec<ConversationRecord>,
}

pub fn project_key(project: &ProjectRecord) -> String {
    let trimmed = project.dir.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        project.dir.clone()
    } else {
        trimmed.to_string()
    }
}

pub fn build_project_items(
    projects: &[ProjectRecord],
    conversations: &[ConversationRecord],
    home_dir: Option<&str>,
) -> Vec<ProjectItem> {
    let mut by_key: HashMap<String, Vec<&ProjectRecord>> = HashMap::new();
    for project in projects {
        by_key
            .entry(project_key(project))
            .or_default()
            .push(project);
    }

    let mut project_key_by_id = HashMap::new();
    for (key, records) in &by_key {
        for project in records {
            project_key_by_id.insert(project.id.clone(), key.clone());
        }
    }

    let mut folder_counts = HashMap::new();
    for records in by_key.values() {
        if let Some(project) = records.first() {
            *folder_counts
                .entry(folder_name(&project.dir))
                .or_insert(0usize) += 1;
        }
    }

    let mut items = Vec::with_capacity(by_key.len());
    for (key, records) in by_key {
        let representative = records
            .iter()
            .copied()
            .max_by(|a, b| a.updated_at.cmp(&b.updated_at))
            .expect("project group is never empty");
        let project_ids: Vec<String> = records.iter().map(|project| project.id.clone()).collect();
        let conversation_count = conversations
            .iter()
            .filter(|conversation| project_ids.contains(&conversation.project_id))
            .count();
        let latest_conversation = conversations
            .iter()
            .filter(|conversation| {
                project_key_by_id
                    .get(&conversation.project_id)
                    .is_some_and(|candidate| candidate == &key)
            })
            .map(ConversationRecord::sort_at)
            .max();
        let sort_at = latest_conversation
            .filter(|candidate| *candidate > representative.updated_at.as_str())
            .unwrap_or(&representative.updated_at)
            .to_string();
        let folder = folder_name(&representative.dir);
        let label = if folder_counts.get(&folder).copied().unwrap_or_default() > 1 {
            short_project_label(&representative.dir, home_dir)
        } else {
            folder
        };
        items.push(ProjectItem {
            key,
            project_id: representative.id.clone(),
            project_ids,
            label,
            dir: representative.dir.clone(),
            conversation_count,
            sort_at,
        });
    }

    items.sort_by(|a, b| {
        b.sort_at
            .cmp(&a.sort_at)
            .then_with(|| a.label.cmp(&b.label))
            .then_with(|| a.key.cmp(&b.key))
    });
    items
}

pub fn build_conversation_sections(
    conversations: &[ConversationRecord],
    project_ids: &[String],
    now: DateTime<Local>,
) -> Vec<ConversationSection> {
    let ids: HashSet<&str> = project_ids.iter().map(String::as_str).collect();
    let mut rows: Vec<_> = conversations
        .iter()
        .filter(|conversation| ids.contains(conversation.project_id.as_str()))
        .cloned()
        .collect();
    rows.sort_by(compare_conversations);

    let kinds = [
        ConversationSectionKind::Pinned,
        ConversationSectionKind::Today,
        ConversationSectionKind::Yesterday,
        ConversationSectionKind::PreviousSevenDays,
        ConversationSectionKind::Older,
    ];
    let mut grouped: HashMap<ConversationSectionKind, Vec<ConversationRecord>> = HashMap::new();
    for row in rows {
        let kind = if row.pinned {
            ConversationSectionKind::Pinned
        } else {
            date_section(row.sort_at(), now.date_naive())
        };
        grouped.entry(kind).or_default().push(row);
    }

    let mut remaining = MAX_LISTED_CONVERSATIONS;
    kinds
        .into_iter()
        .filter_map(|kind| {
            let mut rows = grouped.remove(&kind)?;
            rows.sort_by(compare_completion_then_conversation);
            rows.truncate(remaining);
            remaining = remaining.saturating_sub(rows.len());
            (!rows.is_empty()).then_some(ConversationSection { kind, rows })
        })
        .collect()
}

fn compare_completion_then_conversation(
    a: &ConversationRecord,
    b: &ConversationRecord,
) -> std::cmp::Ordering {
    a.completed_at
        .is_some()
        .cmp(&b.completed_at.is_some())
        .then_with(|| compare_conversations(a, b))
}

fn compare_conversations(a: &ConversationRecord, b: &ConversationRecord) -> std::cmp::Ordering {
    b.sort_at()
        .cmp(a.sort_at())
        .then_with(|| b.created_at.cmp(&a.created_at))
        .then_with(|| a.title.cmp(&b.title))
        .then_with(|| a.id.cmp(&b.id))
}

fn date_section(value: &str, today: NaiveDate) -> ConversationSectionKind {
    let Ok(timestamp) = DateTime::parse_from_rfc3339(value) else {
        return ConversationSectionKind::Older;
    };
    let date = timestamp.with_timezone(&Local).date_naive();
    let age = today.signed_duration_since(date).num_days();
    if age <= 0 {
        ConversationSectionKind::Today
    } else if age == 1 {
        ConversationSectionKind::Yesterday
    } else if age <= 7 {
        ConversationSectionKind::PreviousSevenDays
    } else {
        ConversationSectionKind::Older
    }
}

fn folder_name(dir: &str) -> String {
    let trimmed = dir.trim_end_matches(['/', '\\']);
    trimmed
        .rsplit(['/', '\\'])
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

fn short_project_label(dir: &str, home_dir: Option<&str>) -> String {
    let normalized = dir.replace('\\', "/").trim_end_matches('/').to_string();
    let normalized_home =
        home_dir.map(|home| home.replace('\\', "/").trim_end_matches('/').to_string());
    let path = normalized_home
        .as_ref()
        .filter(|home| normalized == **home || normalized.starts_with(&format!("{home}/")))
        .map(|home| format!("~{}", &normalized[home.len()..]))
        .unwrap_or(normalized);
    let mut segments: Vec<String> = path.split('/').map(|segment| segment.to_string()).collect();
    let last = segments.len().saturating_sub(1);
    for (index, segment) in segments.iter_mut().enumerate() {
        if index == last || segment.is_empty() || segment == "~" {
            continue;
        }
        let take = if segment.starts_with('.') { 2 } else { 1 };
        *segment = segment.chars().take(take).collect();
    }
    segments.join("/")
}

pub fn compact_timestamp(value: &str) -> String {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.with_timezone(&Local).format("%b %-d").to_string())
        .unwrap_or_else(|_| value.to_string())
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn project(id: &str, dir: &str, updated_at: &str) -> ProjectRecord {
        ProjectRecord {
            id: id.to_string(),
            name: folder_name(dir),
            dir: dir.to_string(),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: updated_at.to_string(),
        }
    }

    fn conversation(id: &str, project_id: &str, title: &str, at: &str) -> ConversationRecord {
        ConversationRecord {
            id: id.to_string(),
            project_id: project_id.to_string(),
            title: title.to_string(),
            created_at: at.to_string(),
            updated_at: at.to_string(),
            last_user_message_at: Some(at.to_string()),
            pinned: false,
            completed_at: None,
        }
    }

    #[test]
    fn groups_directory_aliases_and_uses_latest_activity() {
        let projects = vec![
            project("proj_old", "/work/nerve/", "2026-01-01T00:00:00Z"),
            project("proj_new", "/work/nerve", "2026-01-02T00:00:00Z"),
            project("proj_other", "/work/other", "2026-01-03T00:00:00Z"),
        ];
        let conversations = vec![conversation(
            "conv_recent",
            "proj_old",
            "Recent",
            "2026-02-01T00:00:00Z",
        )];

        let items = build_project_items(&projects, &conversations, Some("/home/test"));
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].key, "/work/nerve");
        assert_eq!(items[0].project_id, "proj_new");
        assert_eq!(items[0].project_ids.len(), 2);
        assert_eq!(items[0].conversation_count, 1);
    }

    #[test]
    fn disambiguates_duplicate_folder_names() {
        let projects = vec![
            project("proj_a", "/work/one/app", "2026-01-01T00:00:00Z"),
            project("proj_b", "/work/two/app", "2026-01-02T00:00:00Z"),
        ];
        let items = build_project_items(&projects, &[], Some("/home/test"));
        assert_eq!(items[0].label, "/w/t/app");
        assert_eq!(items[1].label, "/w/o/app");
    }

    #[test]
    fn filters_sorts_groups_and_caps_conversations() {
        let now = Local.with_ymd_and_hms(2026, 9, 4, 12, 0, 0).unwrap();
        let mut conversations = vec![
            conversation("conv_today", "proj_a", "Today", "2026-09-04T08:00:00Z"),
            conversation(
                "conv_yesterday",
                "proj_b",
                "Yesterday",
                "2026-09-03T08:00:00Z",
            ),
            conversation("conv_other", "proj_other", "Other", "2026-09-04T09:00:00Z"),
        ];
        conversations[1].pinned = true;
        for index in 0..105 {
            conversations.push(conversation(
                &format!("conv_old_{index:03}"),
                "proj_a",
                "Old",
                "2026-01-01T00:00:00Z",
            ));
        }

        let sections = build_conversation_sections(
            &conversations,
            &["proj_a".to_string(), "proj_b".to_string()],
            now,
        );
        assert_eq!(sections[0].kind, ConversationSectionKind::Pinned);
        assert_eq!(sections[1].kind, ConversationSectionKind::Today);
        assert_eq!(
            sections
                .iter()
                .map(|section| section.rows.len())
                .sum::<usize>(),
            MAX_LISTED_CONVERSATIONS
        );
        assert!(
            sections
                .iter()
                .flat_map(|section| &section.rows)
                .all(|row| row.project_id != "proj_other")
        );
    }

    #[test]
    fn incomplete_rows_sort_before_completed_rows_within_section() {
        let now = Local.with_ymd_and_hms(2026, 9, 4, 12, 0, 0).unwrap();
        let mut newer = conversation("conv_new", "proj_a", "New", "2026-09-04T10:00:00Z");
        newer.completed_at = Some("2026-09-04T11:00:00Z".to_string());
        let older = conversation("conv_old", "proj_a", "Old", "2026-09-04T09:00:00Z");
        let sections = build_conversation_sections(&[newer, older], &["proj_a".to_string()], now);
        assert_eq!(sections[0].rows[0].id, "conv_old");
    }
}
