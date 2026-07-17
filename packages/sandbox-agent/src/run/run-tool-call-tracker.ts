import {
  toolNameSchema,
  type RunRecord,
  type ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import { sandboxSha256Digest } from "../state/hash.js";
import { previewResult } from "./run-execution-errors.js";

export interface SandboxToolAnchorResolver {
  resolveToolAnchor(providerToolCallId: string):
    | {
        turnId?: string;
        liveMessageId?: string;
        contentIndex?: number;
      }
    | undefined;
}

/** Deterministic transcript id for a provider tool call id. */
export function toolTranscriptId(providerToolCallId: string): string {
  return `tool_${sandboxSha256Digest(providerToolCallId).slice(7, 23)}`;
}

/** Maps a tool name onto its transcript risk classification. */
export function toolRisk(toolName: string): ToolCallTranscriptRecord["risk"] {
  if (["ask_user", "plan_mode_present", "plan_mode_enter"].includes(toolName))
    return "interaction";
  if (toolName === "bash") return "command";
  if (["write", "edit"].includes(toolName)) return "workspace_write";
  if (["explore", "task_start"].includes(toolName)) return "agent_spawn";
  return "read";
}

/**
 * The single owner of tool-call transcript records for one run execution.
 * Every lifecycle revision — inline execution, harness event projection, and
 * interaction continuation — flows through this provider-ID keyed tracker so
 * deterministic ids, live anchors, previews, and timestamps stay coherent.
 */
export class SandboxToolCallTracker {
  private readonly toolCalls = new Map<string, ToolCallTranscriptRecord>();

  constructor(
    private readonly deps: {
      run: RunRecord;
      cwd: string;
      anchors: SandboxToolAnchorResolver;
    },
  ) {}

  get(providerToolCallId: string): ToolCallTranscriptRecord | undefined {
    return this.toolCalls.get(providerToolCallId);
  }

  /**
   * Produces the next lifecycle revision for a provider tool call, or
   * undefined when the tool name is outside the transcript schema.
   */
  record(
    providerToolCallId: string,
    toolName: string,
    status: ToolCallTranscriptRecord["status"],
    args?: unknown,
    result?: unknown,
  ): ToolCallTranscriptRecord | undefined {
    const parsedName = toolNameSchema.safeParse(toolName);
    if (!parsedName.success) return undefined;
    const now = new Date().toISOString();
    const previous = this.toolCalls.get(providerToolCallId);
    const anchor = this.deps.anchors.resolveToolAnchor(providerToolCallId);
    const record: ToolCallTranscriptRecord = {
      id: toolTranscriptId(providerToolCallId),
      agentId: this.deps.run.agentId,
      conversationId: this.deps.run.conversationId,
      projectId: this.deps.run.projectId,
      runId: this.deps.run.runId,
      turnId: anchor?.turnId ?? previous?.turnId,
      liveMessageId: anchor?.liveMessageId ?? previous?.liveMessageId,
      contentIndex: anchor?.contentIndex ?? previous?.contentIndex,
      toolName: parsedName.data,
      providerToolCallId,
      risk: toolRisk(parsedName.data),
      cwd: this.deps.cwd,
      status,
      argsPreview: args ?? previous?.argsPreview,
      resultPreview: previewResult(result),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.toolCalls.set(providerToolCallId, record);
    return record;
  }

  /**
   * Commits the final waiting-status revision for a suspending tool call so
   * restart validation observes the same lifecycle revision the checkpoint
   * captured. Returns undefined when the tool call is unknown.
   */
  markWaiting(
    toolCallId: string,
    waitKind: string,
  ): ToolCallTranscriptRecord | undefined {
    const current = this.toolCalls.get(toolCallId);
    if (!current) return undefined;
    const updated: ToolCallTranscriptRecord = {
      ...current,
      status: waitKind === "approval" ? "pending_approval" : "waiting_for_user",
      updatedAt: new Date().toISOString(),
    };
    this.toolCalls.set(toolCallId, updated);
    return updated;
  }
}
