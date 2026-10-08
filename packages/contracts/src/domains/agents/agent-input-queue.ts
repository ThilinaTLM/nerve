import { z } from "zod";
import {
  agentInputEligibilitySchema,
  agentInputActivationSchema,
  agentInputRecordSchema,
} from "./agent-blueprint.js";

export const agentInputTargetSchema = z
  .object({
    agentId: z.string().startsWith("agent_"),
    conversationId: z.string().startsWith("conv_"),
    runId: z.string().startsWith("run_"),
    attemptId: z.string().min(1),
    turnId: z.string().min(1),
    requiresProvider: z.boolean().optional(),
  })
  .strict();
export type AgentInputTarget = z.infer<typeof agentInputTargetSchema>;

// Acceptance defaults are NOT storage-recovery defaults: a missing persisted target
// or activation must fail closed rather than become a general automatic wake.
const persistedQueueInputSchema = agentInputRecordSchema.safeExtend({
  id: z.string().startsWith("input_"),
  eligibility: agentInputEligibilitySchema,
  activation: agentInputActivationSchema,
});

/** Separate canonical per-agent document, not a journal projection. */
export const agentInputQueueStateSchema = z
  .object({
    revision: z.number().int().nonnegative().safe(),
    nextSequence: z.number().int().nonnegative().safe(),
    paused: z.boolean(),
    wakeRequested: z.boolean().optional(),
    contextPending: z.boolean().optional(),
    controlGeneration: z.number().int().nonnegative().safe().optional(),
    admissionBlocker: z
      .object({
        message: z.string().min(1),
        recordedAt: z.string().datetime(),
        configurationRevision: z.number().int().positive().safe().optional(),
      })
      .strict()
      .optional(),
    inputs: z.array(persistedQueueInputSchema),
    forcePush: z
      .object({
        requestId: z.string().min(1).max(256),
        runId: z.string().startsWith("run_"),
        attemptId: z.string().min(1),
        inputIds: z.array(z.string().startsWith("input_")).min(1),
        cutoffSequence: z.number().int().nonnegative(),
        requestedAt: z.string().datetime(),
        signalled: z.boolean().optional(),
        controlGeneration: z.number().int().nonnegative(),
      })
      .optional(),
    acceptedEligibilities: z
      .record(z.string(), agentInputEligibilitySchema)
      .optional(),
    insertionClaims: z.record(z.string(), agentInputTargetSchema).optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    const indexed = new Map(state.inputs.map((input) => [input.id, input]));
    const keys = new Set<string>();
    const ids = new Set<string>();
    let previousSequence = -1;
    const scope = state.inputs[0];
    for (const [index, input] of state.inputs.entries()) {
      if (!input.id.startsWith("input_") || ids.has(input.id))
        issue(
          ["inputs", index, "id"],
          "Queue input IDs must be unique canonical input_ identities.",
        );
      if (keys.has(input.idempotencyKey))
        issue(
          ["inputs", index, "idempotencyKey"],
          "Input idempotency keys must be unique within the agent queue.",
        );
      if (
        !Number.isSafeInteger(input.sequence) ||
        input.sequence <= previousSequence ||
        input.sequence >= state.nextSequence
      )
        issue(
          ["inputs", index, "sequence"],
          "Acceptance order must be strictly increasing and below nextSequence.",
        );
      if (
        scope &&
        (input.agentId !== scope.agentId ||
          input.conversationId !== scope.conversationId)
      )
        issue(
          ["inputs", index],
          "Queue inputs must share one agent and conversation scope.",
        );
      if (
        input.delivery &&
        input.delivery.contextEntryId !== `entry_${input.id}`
      )
        issue(
          ["inputs", index, "delivery", "contextEntryId"],
          "Delivery must retain the stable input insertion identity.",
        );
      previousSequence = input.sequence;
      ids.add(input.id);
      keys.add(input.idempotencyKey);
    }
    if (state.paused && state.wakeRequested)
      issue(
        ["wakeRequested"],
        "A paused queue cannot retain an automatic wake request.",
      );
    if (
      state.contextPending &&
      !state.inputs.some((input) => input.state === "delivered")
    )
      issue(
        ["contextPending"],
        "Undispatched context must have a delivered insertion receipt.",
      );
    if (
      state.wakeRequested &&
      !state.contextPending &&
      !state.inputs.some(
        (input) =>
          input.state === "pending" && input.eligibility.kind !== "run",
      )
    )
      issue(
        ["wakeRequested"],
        "Wake intent must reference pending general input or undispatched context.",
      );
    if (state.forcePush) {
      const receipt = state.forcePush;
      if (
        new Set(receipt.inputIds).size !== receipt.inputIds.length ||
        receipt.inputIds.some(
          (id) =>
            !indexed.has(id) ||
            indexed.get(id)!.sequence > receipt.cutoffSequence,
        )
      )
        issue(
          ["forcePush", "inputIds"],
          "Force-push must identify an ordered captured input batch.",
        );
      if (receipt.controlGeneration > (state.controlGeneration ?? 0))
        issue(
          ["forcePush", "controlGeneration"],
          "Force-push cannot reference a future control generation.",
        );
    }
    for (const [id, eligibility] of Object.entries(
      state.acceptedEligibilities ?? {},
    )) {
      const input = indexed.get(id);
      if (!input) {
        issue(
          ["acceptedEligibilities", id],
          "Acceptance receipt must identify a queue input.",
        );
        continue;
      }
      const promoted =
        eligibility.kind === "next_run" &&
        input.eligibility.kind === "next_turn";
      if (
        !promoted &&
        JSON.stringify(eligibility) !== JSON.stringify(input.eligibility)
      )
        issue(
          ["acceptedEligibilities", id],
          "Eligibility may differ from acceptance only for explicit next-run promotion.",
        );
    }
    for (const [id, claim] of Object.entries(state.insertionClaims ?? {})) {
      const input = indexed.get(id);
      if (!input || input.state !== "pending") {
        issue(
          ["insertionClaims", id],
          "Only an existing pending input can have an insertion claim.",
        );
        continue;
      }
      if (
        claim.agentId !== input.agentId ||
        claim.conversationId !== input.conversationId
      )
        issue(
          ["insertionClaims", id],
          "Insertion claim must belong to the input's agent/context.",
        );
      if (
        input.eligibility.kind === "run" &&
        claim.runId !== input.eligibility.runId
      )
        issue(
          ["insertionClaims", id, "runId"],
          "Run-targeted insertion cannot redirect to another run.",
        );
      if (
        input.eligibility.kind === "next_run" &&
        input.eligibility.afterRunId === claim.runId
      )
        issue(
          ["insertionClaims", id, "runId"],
          "Deferred input cannot be claimed by the run it follows.",
        );
    }
  });
export type AgentInputQueueState = z.infer<typeof agentInputQueueStateSchema>;

/** Validate the document key/revision too; corruption is an error, never a reset. */
export function parseAgentInputQueueState(
  value: unknown,
  scope: {
    agentId: string;
    conversationId?: string;
    documentRevision?: number;
  },
): AgentInputQueueState {
  const state = agentInputQueueStateSchema.parse(value);
  if (
    scope.documentRevision !== undefined &&
    state.revision !== scope.documentRevision
  )
    throw new Error(
      "Agent input queue document revision does not match its envelope.",
    );
  if (
    state.inputs.some(
      (input) =>
        input.agentId !== scope.agentId ||
        (scope.conversationId !== undefined &&
          input.conversationId !== scope.conversationId),
    )
  )
    throw new Error(
      "Agent input queue document contains foreign context input.",
    );
  return state;
}
