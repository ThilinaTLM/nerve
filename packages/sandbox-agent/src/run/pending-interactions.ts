import type { PlanReviewRecord } from "@nervekit/contracts";

export type PendingInteractionDetail =
  | {
      kind: "question";
      prompt: string;
      context?: string;
      placeholder?: string;
      required?: boolean;
    }
  | {
      kind: "approval";
      prompt: string;
      context?: string;
      risk: string[];
      normalizedArgs: Record<string, unknown>;
      offeredScopes: Array<"single_call" | "same_tool_same_args" | "run">;
    }
  | {
      kind: "plan_review";
      prompt: string;
      context?: string;
      planReview: PlanReviewRecord;
    };

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
}
