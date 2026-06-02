import type { Model } from "@earendil-works/pi-ai";
import {
  AgentHarnessError,
  BranchSummaryError,
  CompactionError,
  SessionError,
} from "./errors.js";
import type {
  AgentHarnessEvent,
  AgentHarnessEventResultMap,
  AgentHarnessOwnEvent,
} from "./events.js";
import type {
  AgentHarnessStreamOptions,
  PromptTemplate,
  Skill,
} from "./options.js";
import { toError } from "./result.js";
import {
  applyStreamOptionsPatch,
  cloneStreamOptions,
} from "./stream-options.js";

const SUBSCRIBER_EVENT_TYPE = "*";

export type AgentHarnessHandler = (
  event: any,
  signal?: AbortSignal,
) => Promise<any> | any;

export function normalizeHarnessError(
  error: unknown,
  fallbackCode: AgentHarnessError["code"],
): AgentHarnessError {
  if (error instanceof AgentHarnessError) return error;
  const cause = toError(error);
  if (cause instanceof SessionError)
    return new AgentHarnessError("session", cause.message, cause);
  if (cause instanceof CompactionError)
    return new AgentHarnessError("compaction", cause.message, cause);
  if (cause instanceof BranchSummaryError)
    return new AgentHarnessError("branch_summary", cause.message, cause);
  return new AgentHarnessError(fallbackCode, cause.message, cause);
}

export function normalizeHookError(error: unknown): AgentHarnessError {
  return normalizeHarnessError(error, "hook");
}

export class AgentHarnessEventHub<
  TSkill extends Skill = Skill,
  TPromptTemplate extends PromptTemplate = PromptTemplate,
> {
  private handlers = new Map<string, Set<AgentHarnessHandler>>();

  private getHandlers(type: string): Set<AgentHarnessHandler> | undefined {
    return this.handlers.get(type);
  }

  async emitOwn(
    event: AgentHarnessOwnEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const listener of this.getHandlers(SUBSCRIBER_EVENT_TYPE) ?? []) {
      try {
        await listener(event, signal);
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
  }

  async emitAny(
    event: AgentHarnessEvent<TSkill, TPromptTemplate>,
    signal?: AbortSignal,
  ): Promise<void> {
    for (const listener of this.getHandlers(SUBSCRIBER_EVENT_TYPE) ?? []) {
      try {
        await listener(event, signal);
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
  }

  async emitHook<TType extends keyof AgentHarnessEventResultMap>(
    event: Extract<AgentHarnessOwnEvent, { type: TType }>,
  ): Promise<AgentHarnessEventResultMap[TType] | undefined> {
    const handlers = this.getHandlers(event.type as TType);
    if (!handlers || handlers.size === 0) return undefined;
    let lastResult: AgentHarnessEventResultMap[TType] | undefined;
    for (const handler of handlers) {
      try {
        const result = await handler(event);
        if (result !== undefined) {
          lastResult = result;
        }
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
    return lastResult;
  }

  async emitBeforeProviderRequest(
    model: Model<any>,
    sessionId: string,
    streamOptions: AgentHarnessStreamOptions,
  ): Promise<AgentHarnessStreamOptions> {
    const handlers = this.getHandlers("before_provider_request");
    let current = cloneStreamOptions(streamOptions);
    if (!handlers || handlers.size === 0) return current;
    for (const handler of handlers) {
      try {
        const result = await handler({
          type: "before_provider_request",
          model,
          sessionId,
          streamOptions: cloneStreamOptions(current),
        });
        if (result?.streamOptions) {
          current = applyStreamOptionsPatch(current, result.streamOptions);
        }
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
    return current;
  }

  async emitBeforeProviderPayload(
    model: Model<any>,
    payload: unknown,
  ): Promise<unknown> {
    const handlers = this.getHandlers("before_provider_payload");
    let current = payload;
    if (!handlers || handlers.size === 0) return current;
    for (const handler of handlers) {
      try {
        const result = await handler({
          type: "before_provider_payload",
          model,
          payload: current,
        });
        if (result !== undefined) {
          current = result.payload;
        }
      } catch (error) {
        throw normalizeHookError(error);
      }
    }
    return current;
  }

  subscribe(
    listener: (
      event: AgentHarnessEvent<TSkill, TPromptTemplate>,
      signal?: AbortSignal,
    ) => Promise<void> | void,
  ): () => void {
    let handlers = this.handlers.get(SUBSCRIBER_EVENT_TYPE);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(SUBSCRIBER_EVENT_TYPE, handlers);
    }
    handlers.add(listener as AgentHarnessHandler);
    return () => handlers!.delete(listener as AgentHarnessHandler);
  }

  on<TType extends keyof AgentHarnessEventResultMap>(
    type: TType,
    handler: (
      event: Extract<AgentHarnessOwnEvent, { type: TType }>,
    ) =>
      | Promise<AgentHarnessEventResultMap[TType]>
      | AgentHarnessEventResultMap[TType],
  ): () => void {
    let handlers = this.handlers.get(type);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(type, handlers);
    }
    handlers.add(handler as AgentHarnessHandler);
    return () => handlers!.delete(handler as AgentHarnessHandler);
  }
}
