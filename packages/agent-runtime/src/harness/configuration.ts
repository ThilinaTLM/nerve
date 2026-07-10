import type { AgentTool, ThinkingLevel } from "../types.js";
import { AgentHarnessError } from "./errors.js";
import type {
  ModelUpdateEvent,
  ThinkingLevelUpdateEvent,
  ToolsUpdateEvent,
} from "./events.js";
import type {
  AgentHarnessResources,
  PromptTemplate,
  Skill,
} from "./options.js";

export function findDuplicateNames(names: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return [...duplicates];
}

export function validateUniqueNames(names: string[], message: string): void {
  const duplicates = findDuplicateNames(names);
  if (duplicates.length > 0)
    throw new AgentHarnessError(
      "invalid_argument",
      `${message}: ${duplicates.join(", ")}`,
    );
}

export function validateToolNames<TTool extends AgentTool>(
  toolNames: string[],
  tools: Map<string, TTool>,
): void {
  validateUniqueNames(toolNames, "Duplicate active tool name(s)");
  const missing = toolNames.filter((name) => !tools.has(name));
  if (missing.length > 0)
    throw new AgentHarnessError(
      "invalid_argument",
      `Unknown tool(s): ${missing.join(", ")}`,
    );
}

export function createToolMap<TTool extends AgentTool>(
  tools: TTool[],
): Map<string, TTool> {
  validateUniqueNames(
    tools.map((tool) => tool.name),
    "Duplicate tool name(s)",
  );
  return new Map(tools.map((tool) => [tool.name, tool]));
}

export interface ToolConfiguration<TTool extends AgentTool> {
  tools: Map<string, TTool>;
  activeToolNames: string[];
}

export interface PreparedToolConfiguration<TTool extends AgentTool>
  extends ToolConfiguration<TTool> {
  event: ToolsUpdateEvent;
}

export function prepareToolConfiguration<TTool extends AgentTool>(options: {
  currentTools: Map<string, TTool>;
  currentActiveToolNames: string[];
  tools: TTool[];
  activeToolNames?: string[];
  source: ToolsUpdateEvent["source"];
}): PreparedToolConfiguration<TTool> {
  const tools = createToolMap(options.tools);
  const activeToolNames = options.activeToolNames
    ? [...options.activeToolNames]
    : [...options.currentActiveToolNames];
  validateToolNames(activeToolNames, tools);
  const previousToolNames = [...options.currentTools.keys()];
  const previousActiveToolNames = [...options.currentActiveToolNames];
  return {
    tools,
    activeToolNames,
    event: {
      type: "tools_update",
      toolNames: [...tools.keys()],
      previousToolNames,
      activeToolNames: [...activeToolNames],
      previousActiveToolNames,
      source: options.source,
    },
  };
}

export function prepareActiveToolsConfiguration<
  TTool extends AgentTool,
>(options: {
  tools: Map<string, TTool>;
  currentActiveToolNames: string[];
  activeToolNames: string[];
  source: ToolsUpdateEvent["source"];
}): { activeToolNames: string[]; event: ToolsUpdateEvent } {
  const activeToolNames = [...options.activeToolNames];
  validateToolNames(activeToolNames, options.tools);
  return {
    activeToolNames,
    event: {
      type: "tools_update",
      toolNames: [...options.tools.keys()],
      previousToolNames: [...options.tools.keys()],
      activeToolNames: [...activeToolNames],
      previousActiveToolNames: [...options.currentActiveToolNames],
      source: options.source,
    },
  };
}

export function createModelUpdateEvent(
  model: ModelUpdateEvent["model"],
  previousModel: ModelUpdateEvent["previousModel"],
  source: ModelUpdateEvent["source"],
): ModelUpdateEvent {
  return { type: "model_update", model, previousModel, source };
}

export function createThinkingLevelUpdateEvent(
  level: ThinkingLevel,
  previousLevel: ThinkingLevel,
): ThinkingLevelUpdateEvent {
  return { type: "thinking_level_update", level, previousLevel };
}

export function cloneHarnessResources<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
>(
  resources: AgentHarnessResources<TSkill, TPromptTemplate>,
): AgentHarnessResources<TSkill, TPromptTemplate> {
  return {
    skills: resources.skills?.slice(),
    promptTemplates: resources.promptTemplates?.slice(),
  };
}
