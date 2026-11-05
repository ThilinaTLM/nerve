import { textCandidate } from "../candidates/text.js";
import { krokiCandidate } from "../candidates/kroki.js";
import { policy } from "./define-policy.js";
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
  readAgentResultPolicy,
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
import { planReviewAgentResultPolicy } from "./plan-review.js";
import {
  processAgentResultPolicy,
  scriptAgentResultPolicy,
} from "./process.js";
import { generateImageAgentResultPolicy } from "./image-generation.js";
import { explainImageAgentResultPolicy } from "./vision.js";
import {
  webFetchAgentResultPolicy,
  webSearchAgentResultPolicy,
} from "./web.js";

const subagentPolicy = policy("lifecycle_state", "item_aware", textCandidate);
// Status repeats the child's capped report, so it must fit whole rather than be cut again.
const subagentStatusPolicy = policy("delegation_report", "head", textCandidate);

const map: Record<ToolName, AgentResultPolicy> = {
  subagent_prompt: subagentPolicy,
  subagent_status: subagentStatusPolicy,
  subagent_stop: subagentPolicy,

  read: readAgentResultPolicy,
  edit: editAgentResultPolicy,
  write: editAgentResultPolicy,
  grep: grepAgentResultPolicy,
  find: findAgentResultPolicy,
  ls: findAgentResultPolicy,
  bash: processAgentResultPolicy,
  python_exec: scriptAgentResultPolicy,
  web_search: webSearchAgentResultPolicy,
  web_fetch: webFetchAgentResultPolicy,
  explain_image: explainImageAgentResultPolicy,
  generate_image: generateImageAgentResultPolicy,
  kroki_export: policy("primary_file_result", "artifact_index", krokiCandidate),
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
  // Log pages are bounded by the process overflow budget, below this inline budget.
  async_bash: policy("process_output", "head", textCandidate),
  launch: policy("process_output", "head", textCandidate),
  plan_present: planReviewAgentResultPolicy,
};

export function agentResultPolicyForTool(name: ToolName): AgentResultPolicy {
  return map[name];
}

export { defineAgentResultPolicy, policy } from "./define-policy.js";
export { safeTerminalResource } from "../terminal-resource.js";
export { textCandidate } from "../candidates/text.js";
export {
  sourceCandidate,
  listingCandidate,
  grepCandidate,
} from "../candidates/filesystem.js";
export { processCandidate } from "../candidates/process.js";
export { searchCandidate } from "../candidates/search.js";
export { mutationCandidate } from "../candidates/mutation.js";
export { resourceCandidate } from "../candidates/resources.js";
export { webFetchCandidate } from "../candidates/web.js";
export { humanCandidate } from "../candidates/interaction.js";
export { primaryFileCandidate } from "../candidates/primary-file.js";
export * from "./confluence.js";
export * from "./filesystem.js";
export * from "./interaction.js";
export * from "./jira.js";
export * from "./plan-review.js";
export * from "./process.js";
export * from "./vision.js";
export * from "./web.js";
