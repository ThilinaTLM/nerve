import { z } from "zod";

export const agentAsyncObligationStateSchema = z.enum([
  "pending",
  "ready",
  "delivered",
  "consumed",
  "cancelled",
  "suppressed",
]);
export type AgentAsyncObligationState = z.infer<
  typeof agentAsyncObligationStateSchema
>;

export const agentAsyncObligationSourceKindSchema = z.enum([
  "promoted_task",
  "async_subagent",
]);
export type AgentAsyncObligationSourceKind = z.infer<
  typeof agentAsyncObligationSourceKindSchema
>;

export function agentAsyncObligationId(
  sourceKind: AgentAsyncObligationSourceKind,
  sourceId: string,
  generation: number,
): string {
  return `${sourceKind}:${sourceId}:${generation}`;
}

/** Stable transcript identity used when registration must be reconstructed. */
export function agentAsyncObligationEntryId(
  sourceKind: AgentAsyncObligationSourceKind,
  sourceId: string,
  generation: number,
): string {
  const sourceSuffix = sourceId.replace(/^[^_]+_/, "");
  return sourceKind === "promoted_task"
    ? `entry_task_${sourceSuffix}_completion`
    : `entry_subagent_${sourceSuffix}_${generation}`;
}

export const agentAsyncObligationSchema = z
  .object({
    id: z.string().min(1).max(512),
    conversationId: z.string().startsWith("conv_"),
    ownerAgentId: z.string().startsWith("agent_"),
    sourceKind: agentAsyncObligationSourceKindSchema,
    sourceId: z.string().min(1).max(256),
    sourceAgentId: z.string().startsWith("agent_").optional(),
    state: agentAsyncObligationStateSchema,
    notificationEntryId: z.string().startsWith("entry_"),
    generation: z.number().int().nonnegative().safe(),
    outcome: z.string().max(16_384).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    deliveredAt: z.string().datetime().optional(),
    consumedAt: z.string().datetime().optional(),
    cancelledAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((obligation, context) => {
    if (
      obligation.id !==
      agentAsyncObligationId(
        obligation.sourceKind,
        obligation.sourceId,
        obligation.generation,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "id must be deterministic from source identity",
      });
    }
    if (obligation.updatedAt < obligation.createdAt) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "updatedAt must not precede createdAt",
      });
    }
    if (obligation.state === "delivered" && !obligation.deliveredAt) {
      context.addIssue({
        code: "custom",
        path: ["deliveredAt"],
        message: "delivered obligations require deliveredAt",
      });
    }
    if (obligation.state === "consumed") {
      if (!obligation.deliveredAt) {
        context.addIssue({
          code: "custom",
          path: ["deliveredAt"],
          message: "consumed obligations require deliveredAt",
        });
      }
      if (!obligation.consumedAt) {
        context.addIssue({
          code: "custom",
          path: ["consumedAt"],
          message: "consumed obligations require consumedAt",
        });
      }
    }
    if (obligation.state === "cancelled" && !obligation.cancelledAt) {
      context.addIssue({
        code: "custom",
        path: ["cancelledAt"],
        message: "cancelled obligations require cancelledAt",
      });
    }
  });
export type AgentAsyncObligation = z.infer<typeof agentAsyncObligationSchema>;

const transitions: Record<
  AgentAsyncObligationState,
  readonly AgentAsyncObligationState[]
> = {
  pending: ["pending", "ready", "cancelled", "suppressed"],
  ready: ["ready", "delivered", "cancelled", "suppressed"],
  delivered: ["delivered", "consumed", "cancelled", "suppressed"],
  consumed: ["consumed"],
  cancelled: ["cancelled"],
  suppressed: ["suppressed"],
};

export function canTransitionAgentAsyncObligation(
  previous: AgentAsyncObligationState,
  next: AgentAsyncObligationState,
): boolean {
  return transitions[previous].includes(next);
}

const immutableIdentityKeys = [
  "id",
  "conversationId",
  "ownerAgentId",
  "sourceKind",
  "sourceId",
  "sourceAgentId",
  "notificationEntryId",
  "generation",
  "createdAt",
] as const satisfies readonly (keyof AgentAsyncObligation)[];

/** Validates a replacement against the immutable identity and monotonic lifecycle. */
export function assertAgentAsyncObligationReplacement(
  previous: AgentAsyncObligation,
  replacement: AgentAsyncObligation,
): void {
  for (const key of immutableIdentityKeys) {
    if (previous[key] !== replacement[key]) {
      throw new Error(`Agent async obligation immutable field changed: ${key}`);
    }
  }
  if (!canTransitionAgentAsyncObligation(previous.state, replacement.state)) {
    throw new Error(
      `Agent async obligation state regressed: ${previous.state} -> ${replacement.state}`,
    );
  }
  if (replacement.updatedAt < previous.updatedAt) {
    throw new Error("Agent async obligation updatedAt moved backwards");
  }
  if (previous.outcome && previous.outcome !== replacement.outcome) {
    throw new Error("Agent async obligation outcome changed");
  }
  for (const key of ["deliveredAt", "consumedAt", "cancelledAt"] as const) {
    if (previous[key] && previous[key] !== replacement[key]) {
      throw new Error(`Agent async obligation timestamp changed: ${key}`);
    }
  }
}

export const agentActivityStateSchema = z.enum([
  "idle",
  "running",
  "awaiting_user",
  "awaiting_async",
  "error",
  "aborted",
]);
export type AgentActivityState = z.infer<typeof agentActivityStateSchema>;

export const agentActivitySnapshotSchema = z
  .object({
    agentId: z.string().startsWith("agent_"),
    conversationId: z.string().startsWith("conv_"),
    state: agentActivityStateSchema,
    activeRunId: z.string().startsWith("run_").optional(),
    pendingInteractionCount: z.number().int().nonnegative().safe(),
    pendingAsyncCount: z.number().int().nonnegative().safe(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type AgentActivitySnapshot = z.infer<typeof agentActivitySnapshotSchema>;

export const conversationActivityStateSchema = z.union([
  agentActivityStateSchema,
  z.literal("completed"),
]);
export type ConversationActivityState = z.infer<
  typeof conversationActivityStateSchema
>;

export const conversationActivitySnapshotSchema = z
  .object({
    conversationId: z.string().startsWith("conv_"),
    activeAgentId: z.string().startsWith("agent_").optional(),
    state: conversationActivityStateSchema,
    pendingInteractionCount: z.number().int().nonnegative().safe(),
    pendingAsyncCount: z.number().int().nonnegative().safe(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ConversationActivitySnapshot = z.infer<
  typeof conversationActivitySnapshotSchema
>;
