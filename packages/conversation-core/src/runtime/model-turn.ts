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
import type { ModelPort, TurnResourcesPort } from "../ports.js";
import type { CoreEmitter } from "./core-change.js";

export interface ModelTurnInput {
  conversation: Conversation;
  config: ConversationConfig;
  projectDir: string;
  path: ConversationEvent[];
  turnId: string;
  signal: AbortSignal;
}
export class ModelTurn {
  constructor(
    private readonly models: ModelPort,
    private readonly resources: TurnResourcesPort,
    private readonly coreDefinitions: () => ToolDefinition[],
    private readonly emit: CoreEmitter,
    private readonly assets?: AssetStore,
  ) {}
  async run(input: ModelTurnInput) {
    const resolved = await this.models.resolve(input.config.model);
    const resources = await this.resources.prepare({
      ...input,
      coreTools: this.coreDefinitions(),
    });
    input.signal.throwIfAborted();
    const tools = new Map(resources.tools.map((tool) => [tool.name, tool]));
    const stream = streamSimpleWithModel(
      resolved.model,
      {
        systemPrompt: input.config.systemPrompt ?? resources.systemPrompt,
        messages: buildModelMessages(
          input.path,
          this.assets
            ? await loadProjectionOptions(input.path, this.assets)
            : {},
        ),
        tools: [...tools.values()].map(({ name, description, parameters }) => ({
          name,
          description,
          parameters,
        })),
      },
      {
        apiKey: resolved.apiKey,
        headers: resolved.headers,
        signal: input.signal,
        reasoning:
          input.config.reasoningLevel === "off"
            ? undefined
            : input.config.reasoningLevel,
      },
    );
    const argumentDrafts = new Map<number, string>();
    for await (const event of stream) {
      if (input.signal.aborted) break;
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
    input.signal.throwIfAborted();
    return stream.result();
  }
}
