import type {
  AgentMessage,
  AgentTool,
  AnyModel,
  QueueMode,
  ThinkingLevel,
} from "../types.js";
import {
  cloneHarnessResources,
  createModelUpdateEvent,
  createThinkingLevelUpdateEvent,
  prepareActiveToolsConfiguration,
  prepareToolConfiguration,
} from "./configuration.js";
import type { Conversation } from "./conversation/conversation.js";
import { AgentHarnessError } from "./errors.js";
import type {
  AbortResult,
  AgentHarnessOwnEvent,
  AgentHarnessPhase,
  PendingConversationWrite,
} from "./events.js";
import { normalizeHarnessError } from "./harness-events.js";
import type {
  AgentHarnessResources,
  AgentHarnessStreamOptions,
  PromptTemplate,
  Skill,
} from "./options.js";
import { toError } from "./result.js";
import { cloneStreamOptions } from "./stream-options.js";

type QueuedMessageEntry = { message: AgentMessage };

export type HarnessConfigurationState<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
> = {
  phase: AgentHarnessPhase;
  conversation: Conversation;
  pendingConversationWrites: PendingConversationWrite[];
  model: AnyModel;
  thinkingLevel: ThinkingLevel;
  tools: Map<string, TTool>;
  activeToolNames: string[];
  steeringQueueMode: QueueMode;
  followUpQueueMode: QueueMode;
  resources: AgentHarnessResources<TSkill, TPromptTemplate>;
  streamOptions: AgentHarnessStreamOptions;
  steerQueue: QueuedMessageEntry[];
  followUpQueue: QueuedMessageEntry[];
  runAbortController?: AbortController;
  emitOwn(event: AgentHarnessOwnEvent): Promise<void>;
  emitQueueUpdate(): Promise<void>;
  waitForIdle(): Promise<void>;
};

export async function setHarnessModel<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessConfigurationState<TSkill, TPromptTemplate, TTool>,
  model: AnyModel,
): Promise<void> {
  try {
    const previousModel = state.model;
    if (state.phase === "idle") {
      await state.conversation.appendModelChange(model.provider, model.id);
    } else {
      state.pendingConversationWrites.push({
        type: "model_change",
        provider: model.provider,
        modelId: model.id,
      });
    }
    state.model = model;
    await state.emitOwn(createModelUpdateEvent(model, previousModel, "set"));
  } catch (error) {
    throw normalizeHarnessError(error, "conversation");
  }
}

export async function setHarnessThinkingLevel<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessConfigurationState<TSkill, TPromptTemplate, TTool>,
  level: ThinkingLevel,
): Promise<void> {
  try {
    const previousLevel = state.thinkingLevel;
    if (state.phase === "idle") {
      await state.conversation.appendThinkingLevelChange(level);
    } else {
      state.pendingConversationWrites.push({
        type: "thinking_level_change",
        thinkingLevel: level,
      });
    }
    state.thinkingLevel = level;
    await state.emitOwn(createThinkingLevelUpdateEvent(level, previousLevel));
  } catch (error) {
    throw normalizeHarnessError(error, "conversation");
  }
}

export async function setHarnessTools<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessConfigurationState<TSkill, TPromptTemplate, TTool>,
  tools: TTool[],
  activeToolNames?: string[],
): Promise<void> {
  try {
    const next = prepareToolConfiguration({
      currentTools: state.tools,
      currentActiveToolNames: state.activeToolNames,
      tools,
      activeToolNames,
      source: "set",
    });
    await writeActiveToolsChange(state, next.activeToolNames);
    state.tools = next.tools;
    state.activeToolNames = [...next.activeToolNames];
    await state.emitOwn(next.event);
  } catch (error) {
    throw normalizeHarnessError(error, "invalid_argument");
  }
}

export function getHarnessActiveTools<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(state: HarnessConfigurationState<TSkill, TPromptTemplate, TTool>): TTool[] {
  return state.activeToolNames.map((name) => {
    const tool = state.tools.get(name);
    if (!tool) {
      throw new AgentHarnessError(
        "invalid_state",
        `Active tool ${name} is not registered`,
      );
    }
    return tool;
  });
}

export async function setHarnessActiveTools<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessConfigurationState<TSkill, TPromptTemplate, TTool>,
  toolNames: string[],
): Promise<void> {
  try {
    const next = prepareActiveToolsConfiguration({
      tools: state.tools,
      currentActiveToolNames: state.activeToolNames,
      activeToolNames: toolNames,
      source: "set",
    });
    await writeActiveToolsChange(state, next.activeToolNames);
    state.activeToolNames = [...next.activeToolNames];
    await state.emitOwn(next.event);
  } catch (error) {
    throw normalizeHarnessError(error, "invalid_argument");
  }
}

export async function setHarnessResources<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessConfigurationState<TSkill, TPromptTemplate, TTool>,
  resources: AgentHarnessResources<TSkill, TPromptTemplate>,
): Promise<void> {
  const previousResources = cloneHarnessResources(state.resources);
  state.resources = cloneHarnessResources(resources);
  await state.emitOwn({
    type: "resources_update",
    resources: cloneHarnessResources(state.resources),
    previousResources,
  });
}

export async function abortHarnessRun<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessConfigurationState<TSkill, TPromptTemplate, TTool>,
): Promise<AbortResult> {
  const clearedSteer = state.steerQueue.map((entry) => entry.message);
  const clearedFollowUp = state.followUpQueue.map((entry) => entry.message);
  state.steerQueue = [];
  state.followUpQueue = [];
  state.runAbortController?.abort();
  const errors: Error[] = [];
  try {
    await state.emitQueueUpdate();
  } catch (error) {
    errors.push(toError(error));
  }
  try {
    await state.waitForIdle();
  } catch (error) {
    errors.push(toError(error));
  }
  try {
    await state.emitOwn({ type: "abort", clearedSteer, clearedFollowUp });
  } catch (error) {
    errors.push(toError(error));
  }
  if (errors.length > 0) {
    const [singleError] = errors;
    const cause =
      errors.length === 1 && singleError
        ? singleError
        : new AggregateError(errors, "Abort completed with errors");
    throw normalizeHarnessError(cause, "hook");
  }
  return { clearedSteer, clearedFollowUp } as AbortResult;
}

export function cloneHarnessStreamOptions(
  streamOptions: AgentHarnessStreamOptions,
): AgentHarnessStreamOptions {
  return cloneStreamOptions(streamOptions);
}

async function writeActiveToolsChange<
  TSkill extends Skill,
  TPromptTemplate extends PromptTemplate,
  TTool extends AgentTool,
>(
  state: HarnessConfigurationState<TSkill, TPromptTemplate, TTool>,
  activeToolNames: string[],
): Promise<void> {
  if (state.phase === "idle") {
    await state.conversation.appendActiveToolsChange(activeToolNames);
  } else {
    state.pendingConversationWrites.push({
      type: "active_tools_change",
      activeToolNames: [...activeToolNames],
    });
  }
}
