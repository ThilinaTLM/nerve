import type { RunRecord } from "@nervekit/contracts";
import type {
  CheckpointCommand,
  RunExecutionSink,
  WaitCommand,
} from "@nervekit/host-runtime";
import type { HarnessFactory } from "../agent/harness-factory.js";
import { sandboxSha256Digest } from "../state/hash.js";
import type { SandboxToolRuntime } from "../tools/tool-runtime.js";
import type { SandboxInteractionChannel } from "./interaction-channel.js";
import type {
  PendingInteractionDetail,
  SandboxPendingInteractions,
} from "./pending-interactions.js";
import type { SandboxRunScope } from "./run-harness-session.js";
import type { SandboxRunReferences } from "./run-references.js";
import type { SandboxToolCallTracker } from "./run-tool-call-tracker.js";

/** Captures checkpoint references at a named boundary for one run. */
export async function buildRunCheckpoint(
  references: SandboxRunReferences,
  runId: string,
  boundary: CheckpointCommand["boundary"],
  interactionId?: string,
): Promise<CheckpointCommand> {
  const transcript = await references.transcript(runId);
  const toolCalls = await references.toolCalls(runId);
  return {
    boundary,
    transcriptCursor: transcript.cursor,
    entryIds: transcript.entryIds,
    harnessLeafId: transcript.harnessLeafId,
    harnessSavePointId: transcript.harnessSavePointId,
    toolCalls: toolCalls.map((call) => ({
      toolCallId: call.toolCallId,
      lifecycleRevision: call.lifecycleRevision,
    })),
    interactionId,
  };
}

/**
 * Owns resolved-interaction continuation for one run execution: idempotent
 * materialization of question/plan/approval results into the harness
 * conversation, approved tool execution or denial, resolution delivery over
 * the interaction channel, serialized suspension decoding, pending-detail
 * lookup, checkpoint creation, and `sink.wait()` construction.
 */
export class SandboxInteractionContinuation {
  constructor(
    private readonly deps: {
      run: RunRecord;
      sink: RunExecutionSink;
      scope: SandboxRunScope;
      signal: AbortSignal;
      references: SandboxRunReferences;
      harnessFactory: HarnessFactory;
      toolRuntime?: SandboxToolRuntime;
      channel: SandboxInteractionChannel;
      pending: SandboxPendingInteractions;
      toolCalls: SandboxToolCallTracker;
    },
  ) {}

  /**
   * Materializes the most recently resolved interaction into the harness
   * conversation as a tool result. Idempotent: the deterministic entry id is
   * derived from the interaction id and resolution request.
   */
  async materializeResolved(): Promise<void> {
    const { run, sink, references, harnessFactory, toolRuntime, toolCalls } =
      this.deps;
    const state = await references.loadRun(run.runId);
    const interaction = [...(state?.interactions ?? [])]
      .reverse()
      .find((item) => item.status === "resolved");
    if (!interaction) return;
    const entryId = `entry_${sandboxSha256Digest(`${interaction.id}:${interaction.resolutionRequestId ?? "resolved"}`).slice(7, 23)}`;
    const conversation = await harnessFactory.openOrCreateConversation(
      interaction.conversationId,
      interaction.agentId,
    );
    if (await conversation.getEntry(entryId)) return;
    const resolution = interaction.resolution ?? {};
    const plan = interaction.kind === "plan_review";
    const approval = interaction.kind === "approval";
    const decision = String(resolution.decision ?? (plan ? "accept" : "allow"));
    const feedback =
      typeof resolution.feedback === "string" ? resolution.feedback : undefined;
    let toolName = plan ? "plan_mode_present" : "ask_user";
    let details: unknown = resolution;
    let content = plan
      ? [
          `Plan review decision: ${decision}.`,
          feedback ? `Feedback: ${feedback}` : undefined,
        ]
          .filter(Boolean)
          .join(" ")
      : String(resolution.text ?? resolution.answer ?? "");
    if (approval) {
      const previous = state?.transitions
        .flatMap((transition) => transition.toolCalls)
        .reverse()
        .find(
          (tool) =>
            tool.providerToolCallId === interaction.toolCallId ||
            tool.id === interaction.toolCallId,
        );
      toolName = previous?.toolName ?? "bash";
      if (decision === "allow") {
        const result = await toolRuntime?.execute(
          toolName,
          interaction.normalizedArgs,
          {
            ...this.deps.scope,
            toolCallId: interaction.toolCallId,
            signal: this.deps.signal,
          },
        );
        details = result;
        content = result?.content ?? "Approved tool call completed.";
        const completed = toolCalls.record(
          interaction.toolCallId,
          toolName,
          "completed",
          interaction.normalizedArgs,
          result,
        );
        if (completed) await sink.upsertToolCalls([completed]);
      } else {
        content = "User denied the requested tool call.";
        const denied = toolCalls.record(
          interaction.toolCallId,
          toolName,
          "denied",
          interaction.normalizedArgs,
          { decision: "deny" },
        );
        if (denied) await sink.upsertToolCalls([denied]);
      }
    }
    await harnessFactory.appendConversationMessage(
      interaction.conversationId,
      interaction.agentId,
      entryId,
      {
        role: "toolResult",
        toolCallId: interaction.toolCallId,
        toolName,
        content: [{ type: "text", text: content }],
        details: plan
          ? {
              decision,
              feedback,
              planReview:
                resolution.planReview &&
                typeof resolution.planReview === "object"
                  ? resolution.planReview
                  : interaction.planReview,
            }
          : details,
        isError: false,
        timestamp: Date.now(),
      },
    );
  }

  /**
   * Called by the coordinator after resolveInteraction commits. Delivers the
   * durable resolution to the live tool awaiting on the interaction channel.
   */
  async deliverResolution(): Promise<void> {
    const state = await this.deps.references.loadRun(this.deps.run.runId);
    if (!state) return;
    for (const interaction of state.interactions) {
      if (interaction.status === "resolved" && interaction.resolution) {
        this.deps.channel.deliver(interaction.id, interaction.resolution);
      }
    }
  }

  /** Decodes a serialized `WAITING_FOR_*` suspension signal, if present. */
  serializedSuspension(error: unknown):
    | {
        toolCallId: string;
        toolName: string;
        detail: PendingInteractionDetail;
      }
    | undefined {
    const message = error instanceof Error ? error.message : String(error);
    const match = /WAITING_FOR_(INPUT|APPROVAL|PLAN_REVIEW):\s*(\S+)/.exec(
      message,
    );
    if (!match) return undefined;
    const pending = this.deps.pending.takeForSignal(match[2]!);
    if (!pending) return undefined;
    return {
      ...pending,
      toolName:
        match[1] === "INPUT"
          ? "ask_user"
          : match[1] === "PLAN_REVIEW"
            ? "plan_mode_present"
            : "tool",
    };
  }

  /**
   * Suspends the run: commits the final waiting tool revision before the
   * checkpoint captures lifecycle revisions, then constructs `sink.wait()`.
   */
  async enterWait(
    toolCallId: string,
    toolName: string,
    knownDetail?: PendingInteractionDetail,
  ): Promise<void> {
    const command = knownDetail ?? this.deps.pending.take(toolCallId);
    const interactionId = command?.interactionId ?? toolCallId;
    const waitKind = command?.kind ?? "question";
    // Commit the final waiting tool revision before capturing checkpoint
    // references so restart validation observes the same lifecycle revision.
    const waiting = this.deps.toolCalls.markWaiting(toolCallId, waitKind);
    if (waiting) await this.deps.sink.upsertToolCalls([waiting]);
    const checkpoint = await buildRunCheckpoint(
      this.deps.references,
      this.deps.run.runId,
      "suspension",
      interactionId,
    );
    const wait: WaitCommand = command
      ? { ...command, interactionId, toolCallId, checkpoint }
      : {
          kind: "question",
          interactionId,
          toolCallId,
          prompt: `Waiting on ${toolName}`,
          required: true,
          checkpoint,
        };
    await this.deps.sink.wait(wait);
  }
}
