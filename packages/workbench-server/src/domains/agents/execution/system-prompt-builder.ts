import type { Skill } from "@nervekit/harness";
import type {
  AgentRecord,
  UserConfigurableToolName,
} from "@nervekit/contracts";
import { promptGuidelinesForTools } from "@nervekit/tools";
import { planDirForStorageHome } from "../../plans/plan-paths.js";
import { activeToolNamesForAgent } from "../../tools/orchestration/agent-tool-adapter.js";
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
    disabledSkillNames?: readonly string[];
    enabledAgentBrowserSkillNames?: readonly string[];
    agentBrowserSkills?: readonly Skill[];
    jiraEnabled?: boolean;
    confluenceEnabled?: boolean;
  } = {},
): Promise<string> {
  const activeToolNames = activeToolNamesForAgent(agent, {
    pythonAvailable: options.pythonAvailable,
    disabledToolNames: options.disabledToolNames,
    jiraEnabled: options.jiraEnabled,
    confluenceEnabled: options.confluenceEnabled,
  });
  const resources = await loadHarnessResources(agent.projectDir, {
    storageHome: options.storageHome,
    disabledSkillNames: options.disabledSkillNames,
    enabledAgentBrowserSkillNames: options.enabledAgentBrowserSkillNames,
    agentBrowserSkills: options.agentBrowserSkills,
  });
  return composeAgentSystemPrompt(agent, activeToolNames, resources, {
    planDir: options.storageHome
      ? planDirForStorageHome(options.storageHome)
      : undefined,
  });
}

/**
 * Synchronous prompt composition shared by the runner (which preloads
 * resources in its hot path) and {@link buildAgentSystemPrompt}.
 */
export function composeAgentSystemPrompt(
  agent: AgentRecord,
  activeToolNames: ReturnType<typeof activeToolNamesForAgent>,
  resources: Awaited<ReturnType<typeof loadHarnessResources>>,
  options: {
    planDir?: string;
  } = {},
): string {
  if (agent.systemPrompt) return agent.systemPrompt;
  return buildNerveSystemPrompt({
    cwd: agent.projectDir,
    mode: agent.mode,
    selectedTools: activeToolNames,
    promptGuidelines: promptGuidelinesForTools(activeToolNames),
    contextFiles: resources.contextFiles,
    skills: resources.skills,
    customPrompt: resources.systemPrompt,
    appendSystemPrompt: resources.appendSystemPrompt,
    planDir: options.planDir,
  });
}
