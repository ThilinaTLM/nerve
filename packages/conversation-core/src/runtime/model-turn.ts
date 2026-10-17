import type { AssetStore } from "../assets/asset-store.js";
import { loadProjectionOptions } from "../context/asset-projection.js";
import { streamSimpleWithModel } from "@nervekit/harness/models";
import type {
  Conversation,
  ConversationConfig,
  ConversationEvent,
} from "@nervekit/contracts/core";
import type { ToolDefinition } from "@nervekit/tools/catalog";
import { buildModelMessages } from "../context/index.js";
import type {
  ModelPort,
  TurnResourcesPort,
  TurnPreparationInput,
} from "../ports.js";
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
    private readonly resources: TurnResourcesPort,
    private readonly coreDefinitions: () => ToolDefinition[],
    private readonly emit: CoreEmitter,
    private readonly assets?: AssetStore,
  ) {}
  async prepare(input: TurnPreparationInput) {
    const snapshot: TurnPreparationInput = {
      conversation: structuredClone(input.conversation),
      config: structuredClone(input.config),
      projectDir: input.projectDir,
      capabilityOverrides: structuredClone(input.capabilityOverrides),
      subagentProfileOverrides: structuredClone(input.subagentProfileOverrides),
    };
    const customPrompt = snapshot.config.systemPrompt;
    const resources = await this.resources.prepare({
      conversation: snapshot.conversation,
      config: snapshot.config,
      projectDir: snapshot.projectDir,
      ...(snapshot.capabilityOverrides
        ? { capabilityOverrides: snapshot.capabilityOverrides }
        : {}),
      ...(snapshot.subagentProfileOverrides
        ? { subagentProfileOverrides: snapshot.subagentProfileOverrides }
        : {}),
      coreTools: this.coreDefinitions(),
    });
    return {
      ...resources,
      systemPrompt: customPrompt ?? resources.systemPrompt,
    };
  }
  async prepareRequest(input: ModelTurnInput) {
    // Own the inputs before awaiting host preparation; later saves must not alter
    // an already prepared provider attempt.
    const config = structuredClone(input.config);
    const resolved = structuredClone(
      await this.models.resolve(structuredClone(config.model)),
    );
    const resources = await this.prepare({ ...input, config });
    const tools = new Map(resources.tools.map((tool) => [tool.name, tool]));
    return {
      resolved,
      reasoning:
        config.reasoningLevel === "off" ? undefined : config.reasoningLevel,
      mode: config.mode,
      systemPrompt: resources.systemPrompt,
      tools: structuredClone(
        [...tools.values()].map(({ name, description, parameters }) => ({
          name,
          description,
          parameters,
        })),
      ),
    } as const;
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
      messages: buildModelMessages(
        input.path,
        this.assets ? await loadProjectionOptions(input.path, this.assets) : {},
      ),
      tools: prepared.tools,
    };
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
