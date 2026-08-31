import type { ToolName } from "@nervekit/contracts/tools";
import type { AgentResultPolicy } from "../types.js";
import {
  confluenceDownloadAgentResultPolicy,
  confluenceMutationAgentResultPolicy,
  confluenceResourceAgentResultPolicy,
  confluenceSearchAgentResultPolicy,
} from "./confluence.js";
import {
  editAgentResultPolicy,
  findAgentResultPolicy,
  grepAgentResultPolicy,
  lsAgentResultPolicy,
  readAgentResultPolicy,
  writeAgentResultPolicy,
} from "./filesystem.js";
import {
  askUserAgentResultPolicy,
  todosAgentResultPolicy,
} from "./interaction.js";
import {
  jiraDownloadAgentResultPolicy,
  jiraMutationAgentResultPolicy,
  jiraResourceAgentResultPolicy,
  jiraSearchAgentResultPolicy,
} from "./jira.js";
import {
  planMutationAgentResultPolicy,
  planReviewAgentResultPolicy,
} from "./plan-mode.js";
import { processAgentResultPolicy } from "./process.js";
import {
  taskLifecycleAgentResultPolicy,
  taskLogsAgentResultPolicy,
} from "./tasks.js";
import { explainImageAgentResultPolicy } from "./vision.js";
import {
  webFetchAgentResultPolicy,
  webSearchAgentResultPolicy,
} from "./web.js";
import { exploreAgentResultPolicy } from "./explore.js";

const map: Record<ToolName, AgentResultPolicy> = {
  read: readAgentResultPolicy,
  edit: editAgentResultPolicy,
  write: writeAgentResultPolicy,
  grep: grepAgentResultPolicy,
  find: findAgentResultPolicy,
  ls: lsAgentResultPolicy,
  bash: processAgentResultPolicy,
  python_exec: processAgentResultPolicy,
  web_search: webSearchAgentResultPolicy,
  web_fetch: webFetchAgentResultPolicy,
  explain_image: explainImageAgentResultPolicy,
  ask_user: askUserAgentResultPolicy,
  todos_set: todosAgentResultPolicy,
  todos_get: todosAgentResultPolicy,
  jira_search_users: jiraSearchAgentResultPolicy,
  jira_search_issues: jiraSearchAgentResultPolicy,
  jira_search_boards: jiraSearchAgentResultPolicy,
  jira_get_issue: jiraResourceAgentResultPolicy,
  jira_get_project: jiraResourceAgentResultPolicy,
  jira_get_board: jiraResourceAgentResultPolicy,
  jira_get_sprint: jiraResourceAgentResultPolicy,
  jira_download_attachment: jiraDownloadAgentResultPolicy,
  jira_create_issue: jiraMutationAgentResultPolicy,
  jira_update_issue: jiraMutationAgentResultPolicy,
  jira_transition_issue: jiraMutationAgentResultPolicy,
  jira_manage_comment: jiraMutationAgentResultPolicy,
  jira_manage_worklog: jiraMutationAgentResultPolicy,
  jira_manage_issue_link: jiraMutationAgentResultPolicy,
  jira_manage_attachment: jiraMutationAgentResultPolicy,
  jira_manage_sprint: jiraMutationAgentResultPolicy,
  jira_manage_backlog: jiraMutationAgentResultPolicy,
  confluence_search_spaces: confluenceSearchAgentResultPolicy,
  confluence_search_pages: confluenceSearchAgentResultPolicy,
  confluence_get_page: confluenceResourceAgentResultPolicy,
  confluence_download_page: confluenceDownloadAgentResultPolicy,
  confluence_create_page: confluenceMutationAgentResultPolicy,
  confluence_update_page: confluenceMutationAgentResultPolicy,
  confluence_manage_comment: confluenceMutationAgentResultPolicy,
  confluence_manage_page: confluenceMutationAgentResultPolicy,
  confluence_manage_label: confluenceMutationAgentResultPolicy,
  confluence_manage_restriction: confluenceMutationAgentResultPolicy,
  confluence_manage_attachment: confluenceMutationAgentResultPolicy,
  task_start: taskLifecycleAgentResultPolicy,
  task_status: taskLifecycleAgentResultPolicy,
  task_logs: taskLogsAgentResultPolicy,
  task_control: taskLifecycleAgentResultPolicy,
  explore: exploreAgentResultPolicy,
  plan_mode_enter: planMutationAgentResultPolicy,
  plan_mode_present: planReviewAgentResultPolicy,
  plan_mode_force_exit: planMutationAgentResultPolicy,
};

export function agentResultPolicyForTool(name: ToolName): AgentResultPolicy {
  return map[name];
}

export * from "./common.js";
export * from "./confluence.js";
export * from "./explore.js";
export * from "./filesystem.js";
export * from "./interaction.js";
export * from "./jira.js";
export * from "./plan-mode.js";
export * from "./process.js";
export * from "./tasks.js";
export * from "./vision.js";
export * from "./web.js";
