import type { AgentRecord } from "@nervekit/contracts/agents";
import type {
  ResolveToolInteractionRequest,
  ToolCallDetails,
  ToolCallRecord,
  ToolCallTranscriptRecord,
  ToolInteractionResolution,
  ToolName,
} from "@nervekit/contracts/tools";
import type { CanonicalInteractionResolutionService } from "../../conversations/timeline/canonical-interaction-resolution.service.js";
import type { ToolService } from "./tool-service.js";
import { CanonicalToolQueryService } from "./canonical-tool-query.service.js";

/** Public tool facade projected from canonical effect and wait authority. */
export class CanonicalToolApplicationService {
  constructor(
    private readonly legacyDefinitions: ToolService,
    private readonly queries: CanonicalToolQueryService,
  ) {}

  listTools() {
    return this.legacyDefinitions.listTools();
  }

  queryToolCallPreviews(
    params?: Parameters<CanonicalToolQueryService["queryToolCallPreviews"]>[0],
  ) {
    return this.queries.queryToolCallPreviews(params);
  }

  listToolCallPreviews(
    params?: Parameters<CanonicalToolQueryService["listToolCallPreviews"]>[0],
  ): Promise<ToolCallTranscriptRecord[]> {
    return this.queries.listToolCallPreviews(params);
  }

  getToolCallUiDetails(toolCallId: string): Promise<ToolCallDetails> {
    return this.queries.getToolCallUiDetails(toolCallId);
  }

  async readToolCallResult(
    toolCallId: string,
    byteOffset = 0,
    byteLimit = 64 * 1024,
  ) {
    void toolCallId;
    void byteLimit;
    return {
      status: "unavailable" as const,
      totalBytes: 0,
      byteOffset,
      nextByteOffset: byteOffset,
      text: "",
      done: true,
    };
  }

  async requestTool(
    _agent: AgentRecord,
    _toolName: ToolName,
    _args: Record<string, unknown>,
  ): Promise<never> {
    void _agent;
    void _toolName;
    void _args;
    throw new Error("Manual tools require a canonical foreground run.");
  }
}

export class CanonicalToolInteractionApplicationService {
  constructor(
    private readonly interactions: CanonicalInteractionResolutionService,
    private readonly queries: CanonicalToolQueryService,
  ) {}

  async resolve(
    input: ResolveToolInteractionRequest,
  ): Promise<{ toolCall: ToolCallRecord }> {
    const resolution = canonicalResolution(input.resolution);
    const result = await this.interactions.resolve({
      providerToolCallId: input.toolCallId,
      ...resolution,
      commandId: input.resolutionRequestId,
      now: new Date().toISOString(),
    });
    if (result.kind === "rejected") {
      throw new Error(
        `Canonical interaction rejected: ${result.outcome.kind}.`,
      );
    }
    return {
      toolCall: (await this.queries.getToolCallUiDetails(input.toolCallId))
        .toolCall,
    };
  }
}

function canonicalResolution(resolution: ToolInteractionResolution): {
  decision:
    | "allow_once"
    | "deny"
    | "answer"
    | "dismiss"
    | "accept"
    | "request_changes"
    | "reject"
    | "discard";
  responseText?: string;
} {
  if (resolution.kind === "approval") {
    if (
      resolution.action === "allow" &&
      resolution.scope !== undefined &&
      resolution.scope !== "single_call"
    ) {
      throw new Error(
        "Remembered canonical grants require a policy save intent.",
      );
    }
    return {
      decision: resolution.action === "allow" ? "allow_once" : "deny",
    };
  }
  if (resolution.kind === "user_input") {
    return {
      decision: resolution.action,
      responseText:
        resolution.action === "answer"
          ? resolution.answer
          : (resolution.reason ?? "Question dismissed."),
    };
  }
  return {
    decision:
      resolution.action === "accept_in_new_chat" ? "accept" : resolution.action,
    responseText: resolution.feedback,
  };
}
