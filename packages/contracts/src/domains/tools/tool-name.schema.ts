import { z } from "zod";

export const coreToolNameSchema = z.enum([
  "read",
  "bash",
  "python_exec",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "ask_user",
  "todos_set",
  "todos_get",
  "web_search",
  "web_fetch",
  "explain_image",
  "jira_search_users",
  "jira_search_issues",
  "jira_get_issue",
  "jira_get_project",
  "jira_search_boards",
  "jira_get_board",
  "jira_get_sprint",
  "jira_download_attachment",
  "jira_create_issue",
  "jira_update_issue",
  "jira_transition_issue",
  "jira_manage_comment",
  "jira_manage_worklog",
  "jira_manage_issue_link",
  "jira_manage_attachment",
  "jira_manage_sprint",
  "jira_manage_backlog",
  "confluence_search_spaces",
  "confluence_search_pages",
  "confluence_get_page",
  "confluence_download_page",
  "confluence_create_page",
  "confluence_update_page",
  "confluence_manage_comment",
  "confluence_manage_page",
  "confluence_manage_label",
  "confluence_manage_restriction",
  "confluence_manage_attachment",
]);
export type CoreToolName = z.infer<typeof coreToolNameSchema>;

export const userConfigurableToolNameSchema = z.enum([
  "web_search",
  "web_fetch",
  "explain_image",
  "python_exec",
]);
export type UserConfigurableToolName = z.infer<
  typeof userConfigurableToolNameSchema
>;

export const orchestrationToolNameSchema = z.enum([
  "task_start",
  "task_status",
  "task_logs",
  "task_control",
  "explore",
  "plan_mode_enter",
  "plan_mode_present",
  "plan_mode_force_exit",
]);
export type OrchestrationToolName = z.infer<typeof orchestrationToolNameSchema>;

export const toolNameSchema = z.enum([
  ...coreToolNameSchema.options,
  ...orchestrationToolNameSchema.options,
]);
export type ToolName = z.infer<typeof toolNameSchema>;

// Tool-call records outlive the manifest that produced them. Keep persisted and
// transcript records readable after tools are renamed or removed while the
// active descriptor/dispatch schemas remain restricted to ToolName.
export const recordedToolNameSchema = z.string().min(1).max(128);
export type RecordedToolName = z.infer<typeof recordedToolNameSchema>;
