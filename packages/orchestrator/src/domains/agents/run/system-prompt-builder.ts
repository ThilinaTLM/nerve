import type { AgentRecord, UserConfigurableToolName } from "@nervekit/shared";
import { planDirForStorageHome } from "../../plans/plan-paths.js";
import {
  activeToolNamesForAgent,
  toolPromptMetadata,
} from "../../tools/agent-tool-adapter.js";
import { buildNerveSystemPrompt } from "../prompting/nerve-system-prompt.js";
import { loadHarnessResources } from "../prompting/resource-loader.js";

/**
 * Rebuild the system prompt for an agent using the exact same inputs the
 * agent runner uses at run time. Deterministic given the agent config and the
 * project resources, so it reflects the prompt used for the agent's messages.
 */
export async function buildAgentSystemPrompt(
  agent: AgentRecord,
  options: {
    storageHome?: string;
    pythonAvailable?: boolean;
    disabledToolNames?: readonly UserConfigurableToolName[];
  } = {},
): Promise<string> {
  const activeToolNames = activeToolNamesForAgent(agent, {
    pythonAvailable: options.pythonAvailable,
    disabledToolNames: options.disabledToolNames,
  });
  const promptMetadata = toolPromptMetadata(activeToolNames);
  const resources = await loadHarnessResources(agent.projectDir, {
    storageHome: options.storageHome,
  });
  return composeAgentSystemPrompt(
    agent,
    activeToolNames,
    promptMetadata,
    resources,
    options.storageHome
      ? { planDir: planDirForStorageHome(options.storageHome) }
      : undefined,
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
  options: { planDir?: string } = {},
): string {
  if (agent.systemPrompt) return agent.systemPrompt;
  return buildNerveSystemPrompt({
    cwd: agent.projectDir,
    mode: agent.mode,
    selectedTools: activeToolNames,
    promptGuidelines: promptMetadata.guidelines,
    contextFiles: resources.contextFiles,
    skills: resources.skills,
    customPrompt: resources.systemPrompt,
    appendSystemPrompt: resources.appendSystemPrompt,
    planDir: options.planDir,
  });
}
