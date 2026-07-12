import type { PlanReviewRecord } from "@nervekit/contracts";

interface PendingInteractionBase {
  /**
   * Explicit durable interaction id. Defaults to the provider toolCallId when
   * omitted; plan review sets it to the plan review record id so client
   * resolution ids line up.
   */
  interactionId?: string;
  prompt: string;
  context?: string;
}

export type PendingInteractionDetail =
  | (PendingInteractionBase & {
      kind: "question";
      placeholder?: string;
      required?: boolean;
    })
  | (PendingInteractionBase & {
      kind: "approval";
      risk: string[];
      normalizedArgs: Record<string, unknown>;
      offeredScopes: Array<"single_call" | "same_tool_same_args" | "run">;
    })
  | (PendingInteractionBase & {
      kind: "plan_review";
      planReview: PlanReviewRecord;
    });

/**
 * Live, in-memory bridge from a tool handler that is about to raise a durable
 * suspension to the execution adapter that catches it. The handler records the
 * interaction detail keyed by toolCallId immediately before throwing the
 * AgentToolSuspension; the execution reads it to build the coordinator wait
 * command. It is intentionally non-durable — after a restart the run resumes
 * from its checkpoint, not from this registry.
 */
export class SandboxPendingInteractions {
  private readonly details = new Map<string, PendingInteractionDetail>();

  set(toolCallId: string, detail: PendingInteractionDetail): void {
    this.details.set(toolCallId, detail);
  }

  take(toolCallId: string): PendingInteractionDetail | undefined {
    const detail = this.details.get(toolCallId);
    this.details.delete(toolCallId);
    return detail;
  }

  /**
   * Resolves a serialized suspension signal. Tool wrappers can convert
   * AgentToolSuspension into a plain Error whose suffix is either the provider
   * toolCallId (question/approval) or explicit interaction id (plan review).
   */
  takeForSignal(
    signalId: string,
  ): { toolCallId: string; detail: PendingInteractionDetail } | undefined {
    for (const [toolCallId, detail] of this.details) {
      if (toolCallId !== signalId && detail.interactionId !== signalId)
        continue;
      this.details.delete(toolCallId);
      return { toolCallId, detail };
    }
    return undefined;
  }
}
