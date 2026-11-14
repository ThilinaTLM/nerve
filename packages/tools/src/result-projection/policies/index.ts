import { textCandidate } from "../candidates/text.js";
import { policy } from "./define-policy.js";
import type { ToolName } from "@nervekit/contracts/tools";
import type { AgentResultPolicy } from "../types.js";
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
import { planReviewAgentResultPolicy } from "./plan-review.js";
import {
  processAgentResultPolicy,
  scriptAgentResultPolicy,
} from "./process.js";
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
  quick_script: scriptAgentResultPolicy,
  web_search: webSearchAgentResultPolicy,
  web_fetch: webFetchAgentResultPolicy,
  explain_image: explainImageAgentResultPolicy,
  ask_user: askUserAgentResultPolicy,
  todos_set: todosAgentResultPolicy,
  todos_get: todosAgentResultPolicy,
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
export { webFetchCandidate } from "../candidates/web.js";
export { humanCandidate } from "../candidates/interaction.js";
export * from "./filesystem.js";
export * from "./interaction.js";
export * from "./plan-review.js";
export * from "./process.js";
export * from "./vision.js";
export * from "./web.js";
