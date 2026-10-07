import { z } from "zod";
import { agentCompletionSchema } from "./agent-blueprint.js";

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
  "user_intervention",
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
  if (sourceKind === "user_intervention")
    return `entry_intervention_${sourceSuffix}_${generation}`;
  return sourceKind === "promoted_task"
    ? `entry_task_${sourceSuffix}_completion`
    : `entry_subagent_${sourceSuffix}_${generation}`;
}

/** Existing outcome JSON carries correlated user action metadata, not user instructions. */
export const userInterventionNoticeSchema = z
  .object({
    action: z.enum([
      "submitted input",
      "changed next-turn configuration",
      "paused the agent",
      "resumed the agent",
    ]),
    childId: z.string().startsWith("agent_"),
    sourceId: z.string().min(1).max(256),
    inputId: z.string().startsWith("input_").optional(),
    configurationRevision: z.number().int().positive().safe().optional(),
    controlGeneration: z.number().int().nonnegative().safe().optional(),
    activationState: z.enum(["enabled", "paused"]).optional(),
  })
  .strict()
  .superRefine((notice, context) => {
    const valid =
      notice.action === "submitted input"
        ? notice.inputId === notice.sourceId &&
          notice.configurationRevision === undefined &&
          notice.controlGeneration === undefined &&
          notice.activationState === undefined
        : notice.action === "changed next-turn configuration"
          ? notice.configurationRevision !== undefined &&
            notice.sourceId ===
              `configuration:${notice.childId}:${notice.configurationRevision}` &&
            notice.inputId === undefined &&
            notice.controlGeneration === undefined &&
            notice.activationState === undefined
          : notice.controlGeneration !== undefined &&
            notice.sourceId ===
              `control:${notice.childId}:${notice.controlGeneration}:${notice.activationState}` &&
            notice.activationState ===
              (notice.action === "paused the agent" ? "paused" : "enabled") &&
            notice.inputId === undefined &&
            notice.configurationRevision === undefined;
    if (!valid)
      context.addIssue({
        code: "custom",
        path: ["sourceId"],
        message:
          "Intervention notice must correlate to exactly its accepted input/configuration/control action.",
      });
  });
export type UserInterventionNotice = z.infer<
  typeof userInterventionNoticeSchema
>;

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
    completion: agentCompletionSchema.optional(),
    queueInputId: z.string().min(1).optional(),
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
    if (
      obligation.completion &&
      (obligation.sourceKind !== "async_subagent" ||
        obligation.completion.runId !== obligation.sourceId ||
        obligation.completion.agentId !== obligation.sourceAgentId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["completion"],
        message:
          "Completion must identify the obligation's exact source agent and run.",
      });
    }
    if (obligation.sourceKind === "user_intervention") {
      if (
        !obligation.sourceAgentId ||
        obligation.sourceAgentId === obligation.ownerAgentId
      ) {
        context.addIssue({
          code: "custom",
          path: ["sourceAgentId"],
          message:
            "User intervention must identify a distinct source child and receiving parent.",
        });
      }
      if (
        obligation.notificationEntryId !==
        agentAsyncObligationEntryId(
          "user_intervention",
          obligation.sourceId,
          obligation.generation,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["notificationEntryId"],
          message:
            "Intervention entry identity must be deterministic from the accepted action.",
        });
      }
      if (
        obligation.outcome === undefined &&
        ["ready", "delivered", "consumed"].includes(obligation.state)
      ) {
        context.addIssue({
          code: "custom",
          path: ["outcome"],
          message:
            "Ready intervention requires its correlated action metadata.",
        });
      }
      if (obligation.outcome !== undefined) {
        let metadata: unknown;
        try {
          metadata = JSON.parse(obligation.outcome);
        } catch {
          metadata = undefined;
        }
        const parsed = userInterventionNoticeSchema.safeParse(metadata);
        if (
          !parsed.success ||
          parsed.data.childId !== obligation.sourceAgentId ||
          parsed.data.sourceId !== obligation.sourceId
        ) {
          context.addIssue({
            code: "custom",
            path: ["outcome"],
            message:
              "Intervention metadata must identify the exact source child and accepted action.",
          });
        }
      }
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
  if (
    previous.completion &&
    JSON.stringify(previous.completion) !==
      JSON.stringify(replacement.completion)
  ) {
    throw new Error("Agent async obligation correlated completion changed");
  }
  if (
    previous.queueInputId &&
    previous.queueInputId !== replacement.queueInputId
  ) {
    throw new Error("Agent async obligation queue input identity changed");
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
