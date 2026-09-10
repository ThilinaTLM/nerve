import type {
  AgentResultProfileId,
  AgentResultStrategyId,
} from "@nervekit/contracts/tools";
import type { AgentResultPolicy, CandidateContext } from "../types.js";
import { safeTerminalResource } from "../terminal-resource.js";

export function defineAgentResultPolicy(
  policy: AgentResultPolicy,
): AgentResultPolicy {
  return Object.freeze(policy);
}

export function policy(
  profile:
    | AgentResultProfileId
    | ((context: CandidateContext) => AgentResultProfileId),
  overflow: AgentResultStrategyId,
  buildCandidate: AgentResultPolicy["buildCandidate"],
): AgentResultPolicy {
  return defineAgentResultPolicy({
    profile,
    overflow,
    buildCandidate,
    terminalResource: safeTerminalResource,
  });
}
