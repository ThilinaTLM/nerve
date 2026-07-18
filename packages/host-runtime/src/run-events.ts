import type {
  ConversationEntry,
  PeerRole,
  QueuedPromptRecord,
  RunCheckpointRecord,
  RunInteractionRecord,
  RunPromptRecord,
  RunPublicEventIntent,
  RunRecord,
} from "@nervekit/contracts";
import { toPlanReviewPreview, validatePublicEvent } from "@nervekit/contracts";

/**
 * Bounded, non-authoritative notify progress/delta emitted by a live
 * execution. It never mutates durable run state and is delivered on a
 * best-effort basis distinct from durable event intents.
 */
export interface RunProgressEvent {
  readonly type: string;
  readonly occurredAt: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Non-authoritative ephemeral progress/delta port. Host adapters use this to
 * surface UI-only streaming without touching durable run state.
 */
export interface RunNotifyEventPort {
  publish(event: RunProgressEvent): void;
}

/**
 * Canonical durable run event construction. Every intent is validated against
 * the public event catalog using the host's own producer role, so both
 * `sandbox_agent` and `workbench_server` publishers are enforced identically.
 */
export class RunEventFactory {
  constructor(private readonly sourceRole: PeerRole) {}

  private intent(
    run: RunRecord,
    type: string,
    occurredAt: string,
    data: Record<string, unknown>,
    identity?: string,
  ): RunPublicEventIntent {
    validatePublicEvent(type, data, this.sourceRole);
    const suffix = identity
      ? `_${identity.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`
      : "";
    return {
      id: `evt_${run.runId.slice(4)}_${run.revision}_${type.replaceAll(".", "_")}${suffix}`,
      type,
      delivery: "sequenced",
      occurredAt,
      data,
    };
  }

  started(run: RunRecord, now: string): RunPublicEventIntent {
    return this.intent(run, "run.started", now, {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      startedAt: now,
    });
  }

  completed(run: RunRecord, now: string): RunPublicEventIntent {
    return this.intent(run, "run.completed", now, {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      completedAt: now,
    });
  }

  failed(
    run: RunRecord,
    now: string,
    interrupted: boolean,
  ): RunPublicEventIntent {
    return this.intent(run, "run.failed", now, {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      message: run.failure?.message ?? "run failed",
      aborted: false,
      interrupted: interrupted || undefined,
      continuable:
        run.status === "interrupted" && run.recoverability === "checkpoint"
          ? true
          : undefined,
      failedAt: now,
    });
  }

  resumed(
    run: RunRecord,
    now: string,
    resumeKind: "interaction" | "manual",
  ): RunPublicEventIntent {
    return this.intent(run, "run.resumed", now, {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      attempt: run.attempt,
      resumeKind,
      resumedAt: now,
    });
  }

  retrying(
    run: RunRecord,
    now: string,
    retry: { attempt: number; maxRetries: number; delayMs: number },
  ): RunPublicEventIntent {
    return this.intent(run, "run.retrying", now, {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      attempt: retry.attempt,
      maxRetries: retry.maxRetries,
      delayMs: retry.delayMs,
      retryAt: new Date(Date.parse(now) + retry.delayMs).toISOString(),
      errorMessage: run.failure?.message,
    });
  }

  queuedPrompt(run: RunRecord, prompt: RunPromptRecord): RunPublicEventIntent {
    return this.intent(run, "conversation.prompt.queued", run.updatedAt, {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      queuedPrompt: prompt satisfies QueuedPromptRecord,
    });
  }

  dequeuedPrompt(
    run: RunRecord,
    prompt: RunPromptRecord,
  ): RunPublicEventIntent {
    return this.intent(
      run,
      "conversation.prompt.dequeued",
      prompt.updatedAt,
      {
        conversationId: run.conversationId,
        agentId: run.agentId,
        projectId: run.projectId,
        runId: run.runId,
        queuedPrompt: prompt satisfies QueuedPromptRecord,
        entryId: prompt.deliveredEntryId,
      },
      prompt.id,
    );
  }

  cancelledPrompt(
    run: RunRecord,
    prompt: RunPromptRecord,
  ): RunPublicEventIntent {
    return this.intent(
      run,
      "conversation.prompt.cancelled",
      prompt.updatedAt,
      {
        conversationId: run.conversationId,
        agentId: run.agentId,
        projectId: run.projectId,
        runId: run.runId,
        queuedPrompt: prompt satisfies QueuedPromptRecord,
      },
      prompt.id,
    );
  }

  checkpointed(
    run: RunRecord,
    checkpoint: RunCheckpointRecord,
  ): RunPublicEventIntent {
    return this.intent(run, "run.checkpointed", checkpoint.createdAt, {
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      checkpointId: checkpoint.checkpointId,
      status: publicStatus(run),
      checkpointedAt: checkpoint.createdAt,
    });
  }

  waiting(
    run: RunRecord,
    interaction: RunInteractionRecord,
  ): RunPublicEventIntent {
    const common = {
      conversationId: run.conversationId,
      agentId: run.agentId,
      runId: run.runId,
      createdAt: interaction.createdAt,
    };
    if (interaction.kind === "question") {
      return this.intent(
        run,
        "run.waiting",
        interaction.createdAt,
        {
          ...common,
          waitKind: "input",
          requestId: interaction.id,
          question: { text: interaction.prompt },
          placeholder: interaction.placeholder,
          required: interaction.required,
        },
        interaction.id,
      );
    }
    if (interaction.kind === "approval") {
      return this.intent(
        run,
        "run.waiting",
        interaction.createdAt,
        {
          ...common,
          waitKind: "approval",
          approvalId: interaction.id,
          toolCallId: interaction.toolCallId,
          risk: interaction.risk,
          reason: interaction.prompt,
          normalizedArgs: interaction.normalizedArgs,
          offeredScopes: interaction.offeredScopes,
        },
        interaction.id,
      );
    }
    return this.intent(
      run,
      "run.waiting",
      interaction.createdAt,
      {
        ...common,
        waitKind: "plan_review",
        reviewId: interaction.planReview.id,
        toolCallId: interaction.toolCallId,
        planReview: toPlanReviewPreview(interaction.planReview),
      },
      interaction.id,
    );
  }

  entryAppended(
    run: RunRecord,
    entry: ConversationEntry,
  ): RunPublicEventIntent {
    return this.intent(
      run,
      "conversation.entry.appended",
      entry.createdAt,
      {
        conversationId: run.conversationId,
        agentId: run.agentId,
        runId: run.runId,
        turnId: entry.turnId,
        liveMessageId: entry.liveMessageId,
        entry,
      },
      entry.id,
    );
  }

  toolCallUpdated(
    run: RunRecord,
    toolCall: import("@nervekit/contracts").ToolCallTranscriptRecord,
  ): RunPublicEventIntent {
    return this.intent(
      run,
      "toolCall.updated",
      toolCall.updatedAt,
      {
        conversationId: run.conversationId,
        agentId: run.agentId,
        projectId: run.projectId,
        runId: run.runId,
        turnId: toolCall.turnId,
        liveMessageId: toolCall.liveMessageId,
        contentIndex: toolCall.contentIndex,
        providerToolCallId: toolCall.providerToolCallId,
        toolCall,
      },
      `${toolCall.id}_${toolCall.updatedAt}`,
    );
  }

  cancelled(run: RunRecord, now: string): RunPublicEventIntent {
    return this.intent(run, "run.cancelled", now, {
      conversationId: run.conversationId,
      agentId: run.agentId,
      projectId: run.projectId,
      runId: run.runId,
      cancelledAt: now,
    });
  }
}

function publicStatus(run: RunRecord): string {
  if (run.status === "waiting") return "waiting_for_input";
  if (["retrying", "interrupted", "cancellation_failed"].includes(run.status)) {
    return "recoverable_failed";
  }
  if (run.status === "starting") return "queued";
  if (run.status === "cancellation_requested") return "running";
  return run.status;
}
