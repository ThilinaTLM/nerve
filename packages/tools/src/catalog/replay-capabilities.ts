import type {
  ToolExecutionRecoveryContract,
  ToolName,
} from "@nervekit/contracts/tools";

const safeObservation = {
  executionClass: "external_effect",
  capability: { kind: "safe_repeat_observation", version: 1 },
} as const satisfies ToolExecutionRecoveryContract;

const nonRepeatable = {
  executionClass: "external_effect",
  capability: { kind: "non_repeatable_or_unknown", version: 1 },
} as const satisfies ToolExecutionRecoveryContract;

const internalCommand = {
  executionClass: "internal_command",
  version: 1,
} as const satisfies ToolExecutionRecoveryContract;

/** INV-EFFECT-01: every exposed tool has an explicit recovery contract. */
export const toolExecutionRecoveryByName = {
  read: safeObservation,
  bash: nonRepeatable,
  python_exec: nonRepeatable,
  edit: nonRepeatable,
  write: nonRepeatable,
  grep: safeObservation,
  find: safeObservation,
  ls: safeObservation,
  ask_user: internalCommand,
  todos_set: internalCommand,
  todos_get: safeObservation,
  web_search: safeObservation,
  web_fetch: safeObservation,
  explain_image: safeObservation,
  jira_search_users: safeObservation,
  jira_search_issues: safeObservation,
  jira_get_issue: safeObservation,
  jira_get_project: safeObservation,
  jira_search_boards: safeObservation,
  jira_get_board: safeObservation,
  jira_get_sprint: safeObservation,
  jira_download_attachment: safeObservation,
  jira_create_issue: nonRepeatable,
  jira_update_issue: nonRepeatable,
  jira_transition_issue: nonRepeatable,
  jira_manage_comment: nonRepeatable,
  jira_manage_worklog: nonRepeatable,
  jira_manage_issue_link: nonRepeatable,
  jira_manage_attachment: nonRepeatable,
  jira_manage_sprint: nonRepeatable,
  jira_manage_backlog: nonRepeatable,
  confluence_search_spaces: safeObservation,
  confluence_search_pages: safeObservation,
  confluence_get_page: safeObservation,
  confluence_download_page: safeObservation,
  confluence_create_page: nonRepeatable,
  confluence_update_page: nonRepeatable,
  confluence_manage_comment: nonRepeatable,
  confluence_manage_page: nonRepeatable,
  confluence_manage_label: nonRepeatable,
  confluence_manage_restriction: nonRepeatable,
  confluence_manage_attachment: nonRepeatable,
  task_start: nonRepeatable,
  task_status: safeObservation,
  task_logs: safeObservation,
  task_control: nonRepeatable,
  explore: nonRepeatable,
  plan_mode_enter: internalCommand,
  plan_mode_present: internalCommand,
  plan_mode_force_exit: internalCommand,
} as const satisfies Record<ToolName, ToolExecutionRecoveryContract>;

export function executionRecoveryForTool(
  name: ToolName,
): ToolExecutionRecoveryContract {
  return toolExecutionRecoveryByName[name];
}
