---
name: jira
description: Usage guide for Nerve's Jira tools.
---

# Jira tools

Keep queries narrow. Mutate Jira only when the user explicitly requests it; `dry_run: true` previews payloads without mutation.

## Find and inspect

- `jira_search_issues` requires bounded JQL containing a field restriction, not just `ORDER BY`. Start with a project and useful filters, e.g. `project = APP AND statusCategory != Done ORDER BY updated DESC`, `key = APP-123`, or `project = APP AND text ~ "login"`. Quote values with spaces; use Jira field names/IDs and valid JQL operators. Request only needed `fields` (default: a narrow summary set).
- Issue search defaults to 25 results (max 100). Pass the returned opaque `next_page_token` unchanged to continue the same query. Do not substitute numeric offsets.
- `jira_get_issue` accepts an issue key or ID. Opt into related `include` data: comments, transitions, editmeta, worklogs, changelog, remote_links, issue_links, attachments. Comments/worklogs/changelog use separate zero-based `*_start_at` offsets and `related_limit` (default 50, max 100). Preview text is bounded; read the saved raw JSON artifact for full results.
- `jira_get_project` defaults to the configured project. Use `include` for statuses, components, versions, issue_types, create_meta, fields, priorities, resolutions, issue_link_types. `issue_type` is an ID or exact name for create metadata; `field_query`/`field_limit` narrow field discovery.
- `jira_search_users` searches issue/project-assignable users when scoped; omitted scope uses the default project if configured. Directory search requires Jira's Browse users and groups permission. Default max_results is 10 (max 50); include_inactive affects directory search only. Resolve ambiguous assignees before changing anything.

## Issues and comments

- Create with `issue_type` (e.g. Task, Story, Bug, Epic, Sub-task), `summary`, and an explicit or default `project_key`. Use `parent_key` for child/subtask issues. Inspect create metadata when required fields are unclear.
- `description` is plain text/markdown-ish text, not a Markdown renderer. Alternatively provide a raw Atlassian Document Format object as `description_adf`; never supply both. The same text/ADF exclusivity applies to comments and worklog comments.
- Typed common fields include labels, priority name, component names (create), and assignee_account_id or assignee_query (resolve one assignable user). Updates replace labels. `fields` merges raw Jira field values; `update` supplies raw Jira update operations on update/transition. Use metadata for field IDs and accepted values.
- `return_issue: true` fetches the resulting issue. `notify_users` controls update notifications.
- `jira_transition_issue`: inspect `include: ["transitions"]` or use dry_run to list transitions. `transition` accepts an ID, transition name, or destination status; include resolution/required fields and optional comment as needed.
- `jira_manage_comment`: create needs body or body_adf; update also needs comment_id; delete needs comment_id. Optional visibility has Jira `type` and `value`.
- `jira_manage_worklog`: create requires exactly one of time_spent (e.g. `1h 30m`) or positive time_spent_seconds; update/delete require worklog_id. `started` is a Jira timestamp. Optional estimate adjustment is new/leave/manual/auto, with new_estimate or increase_by as appropriate. Visibility uses the same type/value object.

## Boards, sprints, links, attachments

- Search boards by project/name/type (scrum, kanban, simple). Board and sprint issue lists use zero-based start_at and limit; board sprints/backlog have separate offsets/limits. Board includes are sprints/backlog; sprint issues require include_issues. Keep issue fields narrow.
- Sprint create requires board_id and name; other actions require sprint_id. Update accepts name/goal/start_date/end_date; start and close change sprint state. Dates use Jira-compatible timestamps.
- Backlog actions: move_to_backlog; move_to_sprint requires sprint_id; rank requires exactly one of rank_before_issue_key/rank_after_issue_key.
- `jira_manage_issue_link` creates issue-to-issue links, not remote URL links: provide issue_key, other_issue_key, link_type, and direction (outward/inward). Discover link types through project metadata. Delete requires link_id; inspect issue_links first. remote_links are readable via get_issue.
- Inspect attachments via get_issue. `jira_download_attachment` takes attachment_id and optional filename, saving a local artifact. Upload requires issue_key and local file_path; filename can override the upload name. Delete requires attachment_id. Uploads and downloads are limited to 25 MiB per attachment. Files are sent to Jira only on requested uploads.
