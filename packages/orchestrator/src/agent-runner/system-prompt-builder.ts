import type { AgentRecord } from "@nerve/shared";
import {
  activeToolNamesForAgent,
  toolPromptMetadata,
} from "../agent-tool-adapter.js";
import { buildPiSystemPrompt } from "../pi-system-prompt.js";
import { loadHarnessResources } from "../resource-loader.js";

/**
 * Rebuild the system prompt for an agent using the exact same inputs the
 * agent runner uses at run time. Deterministic given the agent config and the
 * project resources, so it reflects the prompt used for the agent's messages.
 */
export async function buildAgentSystemPrompt(
  agent: AgentRecord,
): Promise<string> {
  const activeToolNames = activeToolNamesForAgent(agent);
  const promptMetadata = toolPromptMetadata(activeToolNames);
  const resources = await loadHarnessResources(agent.projectDir);
  return composeAgentSystemPrompt(
    agent,
    activeToolNames,
    promptMetadata,
    resources,
  );
}

/**
 * Synchronous prompt composition shared by the runner (which preloads
 * resources/metadata in its hot path) and {@link buildAgentSystemPrompt}.
 */
export function composeAgentSystemPrompt(
  agent: AgentRecord,
  activeToolNames: ReturnType<typeof activeToolNamesForAgent>,
  promptMetadata: ReturnType<typeof toolPromptMetadata>,
  resources: Awaited<ReturnType<typeof loadHarnessResources>>,
): string {
  return buildPiSystemPrompt({
    cwd: agent.projectDir,
    selectedTools: activeToolNames,
    toolSnippets: promptMetadata.snippets,
    promptGuidelines: promptMetadata.guidelines,
    contextFiles: resources.contextFiles,
    skills: resources.skills,
    customPrompt: resources.systemPrompt,
    appendSystemPrompt: resources.appendSystemPrompt,
    nerveContext: nerveSystemContext(agent),
  });
}

export function nerveSystemContext(agent: AgentRecord): string {
  const childContext = agent.parentAgentId
    ? `Parent agent: ${agent.parentAgentId}. Root agent: ${agent.rootAgentId}.`
    : `Root agent: ${agent.rootAgentId}.`;
  return [
    "Nerve orchestration context:",
    `- Mode: ${agent.mode}. Permission level: ${agent.permissionLevel}.`,
    `- ${childContext}`,
    `- Child budget: depth ${agent.budget.depth}/${agent.budget.maxDepth}, runs ${agent.budget.usedRuns}/${agent.budget.maxRuns}.`,
    "- Tool calls may be approved, denied, or constrained according to mode and permission level.",
  ].join("\n");
}
