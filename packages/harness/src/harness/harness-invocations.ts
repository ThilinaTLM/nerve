import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import type { AgentTool } from "../types.js";
import { AgentHarnessError } from "./errors.js";
import type { PromptTemplate, Skill } from "./options.js";
import { formatPromptTemplateInvocation } from "./prompt-templates.js";
import { formatSkillInvocation } from "./skills.js";
import type { AgentHarnessTurnState } from "./turn-state.js";

export type HarnessInvocationState<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
> = {
  runForegroundTurn(
    resolvePrompt: (
      turnState: AgentHarnessTurnState<TSkill, TPromptTemplate, TTool>,
    ) =>
      | { text: string; options?: { images?: ImageContent[] } }
      | Promise<{ text: string; options?: { images?: ImageContent[] } }>,
  ): Promise<AssistantMessage>;
};

export function invokeSkill<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessInvocationState<TSkill, TPromptTemplate, TTool>,
  name: string,
  additionalInstructions?: string,
): Promise<AssistantMessage> {
  return state.runForegroundTurn((turnState) => {
    const skill = (turnState.resources.skills ?? []).find(
      (candidate) => candidate.name === name,
    );
    if (!skill) {
      throw new AgentHarnessError("invalid_argument", `Unknown skill: ${name}`);
    }
    return { text: formatSkillInvocation(skill, additionalInstructions) };
  });
}

export function invokePromptTemplate<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessInvocationState<TSkill, TPromptTemplate, TTool>,
  name: string,
  args: string[],
): Promise<AssistantMessage> {
  return state.runForegroundTurn((turnState) => {
    const template = (turnState.resources.promptTemplates ?? []).find(
      (candidate) => candidate.name === name,
    );
    if (!template) {
      throw new AgentHarnessError(
        "invalid_argument",
        `Unknown prompt template: ${name}`,
      );
    }
    return { text: formatPromptTemplateInvocation(template, args) };
  });
}
