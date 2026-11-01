import type { AgentConfigurationPort } from "../configuration.js";
import type { AssetStore } from "../assets/asset-store.js";
import { loadProjectionOptions } from "../context/asset-projection.js";
import {
  normalizeImagesForModel,
  streamSimpleWithModel,
} from "@nervekit/harness/models";
import type {
  Conversation,
  ConversationConfig,
  ConversationEvent,
} from "@nervekit/contracts/core";
import type { ToolDefinition } from "@nervekit/tools/catalog";
import { buildModelMessages } from "../context/index.js";
import type { ModelPort } from "../ports.js";
import { abortable } from "./abortable.js";
import type { CoreEmitter } from "./core-change.js";

export interface ModelTurnInput {
  conversation: Conversation;
  config: ConversationConfig;
  projectDir: string;
  path: ConversationEvent[];
  turnId: string;
  signal: AbortSignal;
}
export class StaleRequestCaptureError extends Error {
  constructor() {
    super("Request configuration changed during preparation");
  }
}
interface ActiveRequest {
  controller: AbortController;
  runSignal: AbortSignal;
  manualRetry: boolean;
}

export class ModelTurn {
  private readonly activeRequests = new Map<string, ActiveRequest>();

  retryResponse(conversationId: string): void {
    const active = this.activeRequests.get(conversationId);
    if (!active || active.runSignal.aborted)
      throw new Error("No active provider request to retry");
    if (active.manualRetry) return;
    active.manualRetry = true;
    active.controller.abort(new Error("Provider request manually retried"));
  }

  constructor(
    private readonly models: ModelPort,
    private readonly configuration: AgentConfigurationPort,
    private readonly coreDefinitions: () => ToolDefinition[],
    private readonly emit: CoreEmitter,
    private readonly assets?: AssetStore,
  ) {}
  async prepareRequest(input: ModelTurnInput) {
    // The host owns scoped settings. SQL config is context-only, never model authority.
    while (true) {
      input.signal.throwIfAborted();
      const capture = await this.configuration.captureRequest({
        conversation: structuredClone(input.conversation),
        config: structuredClone(input.config),
        projectDir: input.projectDir,
        coreTools: this.coreDefinitions(),
        signal: input.signal,
      });
      let published = false;
      try {
        const snapshot = structuredClone({
          id: capture.id,
          model: capture.model,
          reasoningLevel: capture.reasoningLevel,
          agentProfile: capture.agentProfile,
          systemPrompt: capture.systemPrompt,
          tools: capture.tools.map(({ name, description, parameters }) => ({
            name,
            description,
            parameters,
          })),
        });
        const resolved = structuredClone(
          await this.models.resolve(structuredClone(snapshot.model)),
        );
        input.signal.throwIfAborted();
        if (!capture.isCurrent()) continue;
        const tools = new Map(snapshot.tools.map((tool) => [tool.name, tool]));
        published = true;
        return {
          requestCaptureId: snapshot.id,
          isCurrent: capture.isCurrent,
          resolved,
          model: snapshot.model,
          reasoning:
            snapshot.reasoningLevel === "off"
              ? undefined
              : snapshot.reasoningLevel,
          agentProfile: snapshot.agentProfile,
          systemPrompt: snapshot.systemPrompt,
          tools: structuredClone(
            [...tools.values()].map(({ name, description, parameters }) => ({
              name,
              description,
              parameters,
            })),
          ),
        } as const;
      } finally {
        if (!published) this.configuration.releaseRequest?.(capture.id);
      }
    }
  }

  async run(input: ModelTurnInput) {
    return this.runPrepared(input, await this.prepareRequest(input));
  }
  async runPrepared(
    input: ModelTurnInput,
    prepared: Awaited<ReturnType<ModelTurn["prepareRequest"]>>,
  ) {
    input.signal.throwIfAborted();
    const { resolved } = prepared;
    // Capture context once; manual retry never prepares or delivers inputs again.
    const context = {
      systemPrompt: prepared.systemPrompt,
      // Fit images to provider limits for this request only; stored assets stay original.
      messages: await normalizeImagesForModel(
        buildModelMessages(
          input.path,
          this.assets
            ? await loadProjectionOptions(input.path, this.assets)
            : {},
        ),
        resolved.model,
      ),
      tools: prepared.tools,
    };
    // Projection and image normalization can await. Fence once here; manual response retries below reuse this request.
    if (!prepared.isCurrent()) throw new StaleRequestCaptureError();
    const id = input.conversation.id;
    while (true) {
      input.signal.throwIfAborted();
      const active: ActiveRequest = {
        controller: new AbortController(),
        runSignal: input.signal,
        manualRetry: false,
      };
      const signal = AbortSignal.any([input.signal, active.controller.signal]);
      this.activeRequests.set(id, active);
      try {
        const stream = streamSimpleWithModel(resolved.model, context, {
          apiKey: resolved.apiKey,
          headers: resolved.headers,
          signal,
          reasoning: prepared.reasoning,
          sessionId: id,
        });
        const consume = async () => {
          const argumentDrafts = new Map<number, string>();
          for await (const event of stream) {
            if (signal.aborted || this.activeRequests.get(id) !== active)
              return;
            if (event.type === "text_delta" || event.type === "thinking_delta")
              this.emit({
                kind: "live",
                conversationId: input.conversation.id,
                delta: {
                  type:
                    event.type === "text_delta"
                      ? "assistant_text"
                      : "assistant_thinking",
                  turnId: input.turnId,
                  contentIndex: event.contentIndex,
                  delta: event.delta,
                },
              });
            if (event.type === "toolcall_delta") {
              const draft =
                (argumentDrafts.get(event.contentIndex) ?? "") + event.delta;
              argumentDrafts.set(event.contentIndex, draft);
              const block = event.partial.content[event.contentIndex];
              if (block?.type === "toolCall")
                this.emit({
                  kind: "live",
                  conversationId: input.conversation.id,
                  delta: {
                    type: "tool_call_arguments",
                    turnId: input.turnId,
                    contentIndex: event.contentIndex,
                    providerCallId: block.id,
                    name: block.name,
                    partialArgsText: draft,
                  },
                });
            }
          }
          signal.throwIfAborted();
          return stream.result();
        };
        const result = await abortable(consume(), signal);
        input.signal.throwIfAborted();
        return result!;
      } catch (error) {
        // Stop always wins, including a stop racing a manual retry.
        input.signal.throwIfAborted();
        if (!active.manualRetry) throw error;
        this.emit({
          kind: "live",
          conversationId: id,
          delta: { type: "assistant_reset", turnId: input.turnId },
        });
      } finally {
        if (this.activeRequests.get(id) === active)
          this.activeRequests.delete(id);
      }
    }
  }
}
