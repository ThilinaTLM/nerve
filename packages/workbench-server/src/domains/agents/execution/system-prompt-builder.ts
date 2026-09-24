import type { Skill } from "@nervekit/harness/resources";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { UserConfigurableToolName } from "@nervekit/contracts/tools";
import { promptGuidelinesForTools } from "@nervekit/tools/catalog";
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
    enabledNerveSkillNames?: readonly string[];
    nerveSkills?: readonly Skill[];
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
    enabledNerveSkillNames: options.enabledNerveSkillNames,
    nerveSkills: options.nerveSkills,
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
  if (agent.systemPrompt && agent.executionKind !== "async_developer")
    return agent.systemPrompt;
  return buildNerveSystemPrompt({
    cwd: agent.projectDir,
    mode: agent.executionKind === "async_developer" ? "coding" : agent.mode,
    selectedTools: activeToolNames,
    promptGuidelines: promptGuidelinesForTools(activeToolNames, {
      foregroundOnlyBash: agent.executionKind === "async_developer",
    }),
    contextFiles: resources.contextFiles,
    skills: resources.skills,
    customPrompt: resources.systemPrompt,
    appendSystemPrompt: [
      resources.appendSystemPrompt,
      agent.executionKind === "async_developer"
        ? "You are a persistent autonomous developer teammate. You share the lead agent’s exact working directory and worktree. Follow assigned component ownership, coordinate overlaps through your final response, and never revert another teammate’s changes. There is no Ask User, plan mode, background-task management, Bash auto-promotion, or nested delegation. If blocked or needing clarification, finish with a normal assistant response for the lead. Your conversation is retained for follow-up assignments."
        : undefined,
    ]
      .filter(Boolean)
      .join("\n\n"),
    planDir: options.planDir,
  });
}
