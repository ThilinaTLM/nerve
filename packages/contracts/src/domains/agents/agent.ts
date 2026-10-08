import { z } from "zod";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import { permissionRuleSetIdSchema } from "../permissions/permission-rule-sets.js";
import { permissionLevelSchema } from "../permissions/permissions.js";
import { modeSchema } from "../settings/settings.js";

export const workspaceScopeSchema = z.object({
  roots: z.array(z.string()).min(1),
  readonly: z.boolean().optional(),
});
export type WorkspaceScope = z.infer<typeof workspaceScopeSchema>;

/** Complete per-turn snapshot; tool availability is not authorization. */
export const agentConfigurationSchema = z.object({
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  permissionRuleSetId: permissionRuleSetIdSchema.optional(),
  model: modelSelectionSchema.nullable().optional(),
  thinkingLevel: thinkingLevelSchema,
  projectDir: z.string().min(1),
  workspaceScope: workspaceScopeSchema,
  systemPrompt: z.string().nullable().optional(),
  instructions: z.string().default(""),
  tools: z.array(z.string().min(1)).nullable().default(null),
  skills: z.array(z.string().min(1)).nullable().default(null),
});
export type AgentConfiguration = z.infer<typeof agentConfigurationSchema>;
/** Trusted internal service provenance; intentionally absent from public request schemas. */
export const parentConfigurationSnapshotSchema = z.object({
  agentId: z.string().startsWith("agent_"),
  configurationRevision: z.number().int().positive(),
  configuration: agentConfigurationSchema,
  source: z.object({
    runId: z.string().startsWith("run_"),
    attemptId: z.string().min(1),
    toolCallId: z.string().min(1),
  }),
});
export type ParentConfigurationSnapshot = z.infer<
  typeof parentConfigurationSnapshotSchema
>;

export const updateAgentRequestSchema = agentConfigurationSchema
  .partial()
  .extend({
    instructions: z.string().optional(),
    tools: z.array(z.string().min(1)).nullable().optional(),
    skills: z.array(z.string().min(1)).nullable().optional(),
  });
export type UpdateAgentRequest = z.infer<typeof updateAgentRequestSchema>;
export const agentActivationStateSchema = z.enum(["enabled", "paused"]);
export const agentOrchestrationPolicySchema = z.object({
  preset: z.enum(["standard", "explore", "developer"]),
  parentCancellation: z.enum(["attached", "independent"]),
  completionReporting: z.enum(["none", "parent"]),
});
export type AgentOrchestrationPolicy = z.infer<
  typeof agentOrchestrationPolicySchema
>;
export const agentParentGrantsSchema = z.object({
  prompt: z.boolean().default(true),
  configure: z.boolean().default(true),
  stop: z.boolean().default(true),
});

export const agentBudgetSchema = z.object({
  depth: z.number().int().nonnegative().default(0),
  maxDepth: z.number().int().positive().max(8).default(3),
  maxConcurrentChildren: z.number().int().positive().max(64).optional(),
});
export type AgentBudget = z.infer<typeof agentBudgetSchema>;

export const createAgentBudgetRequestSchema = agentBudgetSchema.partial();
export type CreateAgentBudgetRequest = z.infer<
  typeof createAgentBudgetRequestSchema
>;

/** Narrow canonical document; survives deletion of the original lead identity. */
export const agentContextBindingSchema = z.object({
  legacyRootAgentId: z.string().startsWith("agent_"),
});
export type AgentContextBinding = z.infer<typeof agentContextBindingSchema>;

/** Authenticated INTERNAL provenance; never a public create/update request field. */
export const agentConfigurationActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal("parent"),
      agentId: z.string().startsWith("agent_"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("self"),
      agentId: z.string().startsWith("agent_"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("system"),
      producer: z.string().min(1),
      correlationId: z.string().min(1).optional(),
    })
    .strict(),
]);
export type AgentConfigurationActor = z.infer<
  typeof agentConfigurationActorSchema
>;
export const agentConfigurationAcceptanceSchema = z
  .object({
    agentId: z.string().startsWith("agent_"),
    conversationId: z.string().startsWith("conv_"),
    parentAgentId: z.string().startsWith("agent_").optional(),
    configurationRevision: z.number().int().positive().safe(),
    actor: agentConfigurationActorSchema,
    acceptedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((receipt, context) => {
    if (
      (receipt.actor.kind === "parent" &&
        (receipt.actor.agentId !== receipt.parentAgentId ||
          receipt.actor.agentId === receipt.agentId)) ||
      (receipt.actor.kind === "self" &&
        receipt.actor.agentId !== receipt.agentId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["actor"],
        message:
          "Configuration actor must identify this exact self or parent relationship.",
      });
    }
  });
export type AgentConfigurationAcceptance = z.infer<
  typeof agentConfigurationAcceptanceSchema
>;

export const agentRecordSchema = z
  .object({
    id: z.string().startsWith("agent_"),
    conversationId: z.string().startsWith("conv_"),
    projectId: z.string().startsWith("proj_"),
    projectDir: z.string().min(1),
    parentAgentId: z.string().startsWith("agent_").optional(),
    executionKind: z.enum(["root", "explore", "async_developer"]).optional(),
    name: z.string().trim().min(1).max(80).optional(),
    rootAgentId: z.string().startsWith("agent_"),
    /** Immutable storage binding: null selects historical lead; id selects isolated agent context. */
    contextOwnerAgentId: z.string().startsWith("agent_").nullable().optional(),
    mode: modeSchema,
    permissionLevel: permissionLevelSchema,
    permissionRuleSetId: permissionRuleSetIdSchema.optional(),
    workspaceScope: workspaceScopeSchema,
    systemPrompt: z.string().min(1).optional(),
    /** Subagent work description; present on child agents spawned by orchestration tools. */
    task: z.string().optional(),
    budget: agentBudgetSchema.default({
      depth: 0,
      maxDepth: 3,
    }),
    model: modelSelectionSchema.optional(),
    thinkingLevel: thinkingLevelSchema.default("off"),
    instructions: z.string().optional(),
    tools: z.array(z.string().min(1)).nullable().optional(),
    skills: z.array(z.string().min(1)).nullable().optional(),
    configurationRevision: z.number().int().positive().optional(),
    /** Narrow immutable acceptance receipts committed with settings, not a journal projection. */
    configurationAcceptances: z
      .array(agentConfigurationAcceptanceSchema)
      .optional(),
    effectiveConfigurationRevision: z.number().int().nonnegative().optional(),
    activationState: agentActivationStateSchema.optional(),
    orchestrationPolicy: agentOrchestrationPolicySchema.optional(),
    readOnlyCeiling: z.boolean().optional(),
    parentGrants: agentParentGrantsSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((agent, context) => {
    let previous = 0;
    for (const [index, receipt] of (
      agent.configurationAcceptances ?? []
    ).entries()) {
      if (
        receipt.agentId !== agent.id ||
        receipt.conversationId !== agent.conversationId ||
        receipt.parentAgentId !== agent.parentAgentId ||
        receipt.configurationRevision <= previous
      ) {
        context.addIssue({
          code: "custom",
          path: ["configurationAcceptances", index],
          message:
            "Acceptance receipts must retain agent context and strictly ordered accepted revisions.",
        });
      }
      previous = receipt.configurationRevision;
    }
  });
export type AgentRecord = z.infer<typeof agentRecordSchema>;

export const createAgentRequestSchema = z.object({
  conversationId: z.string().startsWith("conv_"),
  projectId: z.string().startsWith("proj_"),
  projectDir: z.string().min(1).optional(),
  parentAgentId: z.string().startsWith("agent_").optional(),
  name: z.string().trim().min(1).max(80).optional(),
  task: z.string().optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
  permissionRuleSetId: permissionRuleSetIdSchema.optional(),
  workspaceScope: workspaceScopeSchema.optional(),
  systemPrompt: z.string().min(1).optional(),
  instructions: z.string().optional(),
  tools: z.array(z.string().min(1)).nullable().optional(),
  skills: z.array(z.string().min(1)).nullable().optional(),
  orchestrationPolicy: agentOrchestrationPolicySchema.optional(),
  readOnlyCeiling: z.boolean().optional(),
  parentGrants: agentParentGrantsSchema.partial().optional(),
  budget: createAgentBudgetRequestSchema.optional(),
  model: modelSelectionSchema.optional(),
  thinkingLevel: thinkingLevelSchema.optional(),
});
export type CreateAgentRequest = z.infer<typeof createAgentRequestSchema>;

/** One-time deterministic decoding of historical kind data, not runtime policy. */
export function resolveAgentBlueprint(record: AgentRecord): AgentRecord {
  const preset =
    record.orchestrationPolicy?.preset ??
    (record.executionKind === "explore"
      ? "explore"
      : record.executionKind === "async_developer"
        ? "developer"
        : "standard");
  return agentRecordSchema.parse({
    ...record,
    workspaceScope:
      (record.readOnlyCeiling ?? preset === "explore")
        ? { ...record.workspaceScope, readonly: true }
        : record.workspaceScope,
    budget: {
      ...record.budget,
      maxConcurrentChildren: record.budget.maxConcurrentChildren ?? 4,
    },
    configurationRevision: record.configurationRevision ?? 1,
    effectiveConfigurationRevision: record.effectiveConfigurationRevision ?? 0,
    activationState: record.activationState ?? "enabled",
    instructions: record.instructions ?? "",
    tools: record.tools ?? null,
    skills: record.skills ?? null,
    orchestrationPolicy: record.orchestrationPolicy ?? {
      preset,
      parentCancellation: preset === "explore" ? "attached" : "independent",
      completionReporting: preset === "developer" ? "parent" : "none",
    },
    readOnlyCeiling: record.readOnlyCeiling ?? preset === "explore",
    parentGrants: record.parentGrants ?? agentParentGrantsSchema.parse({}),
  });
}

/** Availability only; dispatch must still enforce permissions and revocation. */
export function isAgentToolConfigured(
  configuration: Pick<AgentConfiguration, "tools">,
  name: string,
): boolean {
  return configuration.tools === null || configuration.tools.includes(name);
}
