import { z } from "zod";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import { permissionRuleSetIdSchema } from "../permissions/permission-rule-sets.js";
import {
  agentProfileNameSchema,
  agentProfileInstructionsSchema,
  AGENT_PROFILE_LABEL_MAX_LENGTH,
  AGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
} from "../agent-profiles/constants.js";
import {
  capabilitySkillsSchema,
  capabilityToolPayloadSchemas,
} from "../capabilities/capabilities.js";
import {
  bashToolSettingsSchema,
  compactionProfileSchema,
  imageExplanationToolSettingsSchema,
  openAiCodexImageGenerationSettingsSchema,
  planPresentToolSettingsSchema,
  pythonExecToolSettingsSchema,
  krokiToolSettingsSchema,
} from "../settings/settings.js";

const model = modelSelectionSchema.strict();
const nonempty = (value: object) => Object.keys(value).length > 0;
const compaction = z.strictObject({
  auto: z.boolean(),
  profile: compactionProfileSchema,
  customTriggerPercent: z.number().int().min(60).max(90),
});
const retry = z.strictObject({
  enabled: z.boolean(),
  maxRetries: z.number().int().nonnegative(),
  baseDelayMs: z.number().int().positive(),
});
const bash = bashToolSettingsSchema
  .extend({
    autoPromotion: bashToolSettingsSchema.shape.autoPromotion.strict(),
    maxTimeoutMs: bashToolSettingsSchema.shape.maxTimeoutMs.removeDefault(),
  })
  .strict();
const explanation = imageExplanationToolSettingsSchema
  .extend({ model: model.optional() })
  .strict();
const generation = openAiCodexImageGenerationSettingsSchema
  .extend({
    options: openAiCodexImageGenerationSettingsSchema.shape.options.strict(),
  })
  .strict();
const sourceDefaults = z.strictObject({
  file: z.boolean(),
  nerve: z.boolean(),
  agentBrowser: z.boolean(),
});
const skills = capabilitySkillsSchema
  .partial()
  .extend({ defaults: sourceDefaults.partial().optional() })
  .strict();
function payload<S extends z.ZodType>(settings: S) {
  return z
    .strictObject({
      enabled: z.boolean().optional(),
      settings: settings.optional(),
    })
    .refine(nonempty, "Empty tool entry");
}
const toggle = z.strictObject({ enabled: z.boolean() });
const account = capabilityToolPayloadSchemas.jira.refine(
  nonempty,
  "Empty tool entry",
);
const childToolShape = {
  python_exec: payload(pythonExecToolSettingsSchema.partial()),
  web_search: account,
  jira: account,
  confluence: account,
  web_fetch: toggle,
  explain_image: payload(explanation.partial().refine(nonempty)),
  generate_image: payload(generation),
  kroki_export: payload(krokiToolSettingsSchema.partial().refine(nonempty)),
  bash: z.strictObject({ settings: bash.partial().refine(nonempty) }),
};
const leadTools = z
  .strictObject({
    ...childToolShape,
    plan_present: payload(
      planPresentToolSettingsSchema.partial().refine(nonempty),
    ),
    subagents: toggle,
  })
  .partial();
const childTools = z.strictObject(childToolShape).partial();
const launch = z.strictObject({
  model: model.optional(),
  reasoningLevel: thinkingLevelSchema.optional(),
});
export const childLaunchOverridesSchema = launch;
const subagent = launch
  .extend({ enabled: z.boolean().optional() })
  .refine(nonempty);
const childShape = {
  model: model.optional(),
  reasoningLevel: thinkingLevelSchema.optional(),
  permissionRuleSetId: permissionRuleSetIdSchema.optional(),
  compaction: compaction.partial().optional(),
  retry: retry.partial().optional(),
  tools: childTools.optional(),
  skills: skills.optional(),
};
export const childSettingsOverridesSchema = z.strictObject(childShape);
export const leadSettingsOverridesSchema = z.strictObject({
  ...childShape,
  tools: leadTools.optional(),
  subagents: z.record(agentProfileNameSchema, subagent).optional(),
});
export type LeadSettingsOverrides = z.infer<typeof leadSettingsOverridesSchema>;
export type ChildSettingsOverrides = z.infer<
  typeof childSettingsOverridesSchema
>;
const completeTools = z.strictObject({
  python_exec: z.strictObject({
    enabled: z.boolean(),
    settings: pythonExecToolSettingsSchema,
  }),
  web_search: capabilityToolPayloadSchemas.web_search.required({
    enabled: true,
  }),
  jira: capabilityToolPayloadSchemas.jira.required({ enabled: true }),
  confluence: capabilityToolPayloadSchemas.confluence.required({
    enabled: true,
  }),
  web_fetch: toggle,
  explain_image: z.strictObject({
    enabled: z.boolean(),
    settings: explanation,
  }),
  generate_image: z.strictObject({
    enabled: z.boolean(),
    settings: generation,
  }),
  kroki_export: z.strictObject({
    enabled: z.boolean(),
    settings: krokiToolSettingsSchema,
  }),
  bash: z.strictObject({ settings: bash }),
});
export const completeChildSettingsSchema = childSettingsOverridesSchema.extend({
  reasoningLevel: thinkingLevelSchema,
  permissionRuleSetId: permissionRuleSetIdSchema,
  compaction,
  retry,
  tools: completeTools,
  skills: capabilitySkillsSchema.extend({ defaults: sourceDefaults }).strict(),
});
export type CompleteChildSettings = z.infer<typeof completeChildSettingsSchema>;
export const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const contribution = {
  name: agentProfileNameSchema,
  source: z.enum(["builtin", "user", "project"]),
  sourceDigest: sha256HexSchema,
  instructions: agentProfileInstructionsSchema,
};
export const appliedProfileSchema = z
  .strictObject({
    ...contribution,
    recommendations: leadSettingsOverridesSchema,
    requirements: leadSettingsOverridesSchema,
  })
  .superRefine(checkOverlap);
export type AppliedProfile = z.infer<typeof appliedProfileSchema>;
export const agentPreferencesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision,
  overrides: leadSettingsOverridesSchema,
});
/** Historical lastTransition metadata only: no runtime authority; omit on rewrites. */
const receipt = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(["profile", "plan-approval"]),
});
/** Conversation-local prompt context, never a merge layer or profile contribution. */
export const conversationAgentContextSchema = z.strictObject({
  instructions: agentProfileInstructionsSchema.optional(),
  systemPrompt: z.string().optional(),
});
export type ConversationAgentContext = z.infer<
  typeof conversationAgentContextSchema
>;
export const leadConversationAgentSchema = agentPreferencesSchema.extend({
  context: conversationAgentContextSchema.optional(),
  appliedProfile: appliedProfileSchema.nullable(),
  lastTransition: receipt.optional(),
});
/** Persisted child documents: select by trusted conversation ownership, never
 * by a JSON role field or a union fallback to the permissive lead document.
 * A complete creation-time baseline is mandatory, not a recovery default. */
export const childConversationAgentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    revision,
    overrides: childSettingsOverridesSchema,
    appliedProfile: appliedProfileSchema.nullable(),
    frozenDefaults: completeChildSettingsSchema,
    context: conversationAgentContextSchema.optional(),
    lastTransition: receipt.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.appliedProfile)
      for (const section of ["recommendations", "requirements"] as const) {
        const parsed = childSettingsOverridesSchema.safeParse(
          v.appliedProfile[section],
        );
        if (!parsed.success)
          ctx.addIssue({
            code: "custom",
            path: ["appliedProfile", section],
            message: "Child-prohibited profile contribution",
          });
      }
  });
export const profileDefinitionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: agentProfileNameSchema,
    label: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_PROFILE_LABEL_MAX_LENGTH)
      .optional(),
    description: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_PROFILE_DESCRIPTION_MAX_LENGTH),
    /** Authored launch default (true if omitted), not availability or a requirement. */
    enabled: z.boolean().optional(),
    usableBy: z.enum(["lead", "subagent", "both"]),
    instructions: agentProfileInstructionsSchema,
    recommendations: leadSettingsOverridesSchema.optional(),
    requirements: leadSettingsOverridesSchema.optional(),
  })
  .superRefine((v, ctx) => {
    checkOverlap(v, ctx);
    if (v.usableBy !== "lead")
      for (const section of ["recommendations", "requirements"] as const)
        if (
          v[section] &&
          !childSettingsOverridesSchema.safeParse(v[section]).success
        )
          ctx.addIssue({
            code: "custom",
            path: [section],
            message: "Profile must be child-compatible",
          });
  });
export type ProfileUsableBy = z.infer<
  typeof profileDefinitionSchema
>["usableBy"];
export const conversationDefaultsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  revision,
  overrides: z.strictObject({
    defaultAgentProfile: agentProfileNameSchema.optional(),
    scopedModels: z.array(model).optional(),
  }),
});
export const agentSummarySchema = z.strictObject({
  model: model.optional(),
  reasoningLevel: thinkingLevelSchema.optional(),
  permissionRuleSetId: permissionRuleSetIdSchema.optional(),
  agentProfile: agentProfileNameSchema.optional(),
});
export const conversationAgentSummariesSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.record(
    z.string().min(1),
    agentSummarySchema.extend({ observedDigest: sha256HexSchema }),
  ),
});
export const configurationDiagnosticSchema = z.strictObject({
  scope: z.enum(["user", "project", "conversation"]),
  scopeId: z.string().optional(),
  document: z.string().min(1),
  path: z.string(),
  schemaVersion: z.number().int().optional(),
  code: z.string().min(1),
  pointer: z.string(),
  message: z.string().optional(),
  affectedCapability: z.string().min(1),
  recoveryChoices: z.array(
    z.enum(["retry", "reload", "repair", "reset", "upgrade"]),
  ),
});

export const configurationSourceSchema = z.enum([
  "builtin",
  "user",
  "project",
  "process",
  "recommendation",
  "conversation",
  "requirement",
  "frozen",
  "launch",
]);
export const fieldProvenanceSchema = z
  .strictObject({
    source: configurationSourceSchema,
    profile: agentProfileNameSchema.optional(),
    adjusted: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.source === "requirement" || value.source === "recommendation") &&
      !value.profile
    )
      ctx.addIssue({
        code: "custom",
        path: ["profile"],
        message: "Profile contributions must identify the controlling profile",
      });
  });
export const resolutionDiagnosticSchema = z.strictObject({
  code: z.enum([
    "model-required",
    "reasoning-adjusted",
    "unsupported-reasoning",
    "missing-reference",
  ]),
  pointer: z.string(),
});
export const agentResolutionSchema = z.strictObject({
  settings: leadSettingsOverridesSchema,
  provenance: z.record(
    z.string().regex(/^\/(?:[^~]|~[01])*$/),
    fieldProvenanceSchema,
  ),
  diagnostics: z.array(resolutionDiagnosticSchema),
});

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
/** Canonical atomic fields are leaves even when their values are objects. */
export function canonicalSettingsEntries(
  value: LeadSettingsOverrides,
): [string, unknown][] {
  const entries: [string, unknown][] = [];
  function walk(node: unknown, path: string) {
    const atomic =
      /(?:^|\/)model$/.test(path) ||
      path === "/tools/generate_image/settings" ||
      path === "/tools/bash/settings/autoPromotion";
    if (
      node !== undefined &&
      (atomic ||
        typeof node !== "object" ||
        node === null ||
        Array.isArray(node))
    )
      entries.push([path, node]);
    else if (node)
      for (const [key, child] of Object.entries(node))
        walk(child, `${path}/${escapePointer(key)}`);
  }
  walk(value, "");
  return entries;
}
export function requirementOverlaps(
  recommendations: LeadSettingsOverrides = {},
  requirements: LeadSettingsOverrides = {},
): string[] {
  const a = canonicalSettingsEntries(recommendations).map(([p]) => p),
    b = canonicalSettingsEntries(requirements).map(([p]) => p);
  function overlaps(x: string, y: string) {
    if (x === y || x.startsWith(y + "/") || y.startsWith(x + "/")) return true;
    const source = (p: string) =>
      p.startsWith("/skills/defaults/")
        ? p.slice(17)
        : p.startsWith("/skills/")
          ? p.split("/")[2]
          : undefined;
    return (
      source(x) !== undefined &&
      source(x) === source(y) &&
      (x.startsWith("/skills/defaults/") || y.startsWith("/skills/defaults/"))
    );
  }
  return a.filter((x) => b.some((y) => overlaps(x, y)));
}
function checkOverlap(
  v: {
    recommendations?: LeadSettingsOverrides;
    requirements?: LeadSettingsOverrides;
  },
  ctx: z.RefinementCtx,
) {
  for (const pointer of requirementOverlaps(v.recommendations, v.requirements))
    ctx.addIssue({
      code: "custom",
      path: ["requirements"],
      message: `Recommendation/requirement overlap: ${pointer}`,
    });
}
/** Generated on demand: no independently maintained editor validator. Use input mode for transformed URLs. */
export function configurationJSONSchemas() {
  return Object.fromEntries(
    Object.entries({
      agentPreferences: agentPreferencesSchema,
      leadConversationAgent: leadConversationAgentSchema,
      childConversationAgent: childConversationAgentSchema,
      profileDefinition: profileDefinitionSchema,
      conversationDefaults: conversationDefaultsSchema,
      conversationAgentSummaries: conversationAgentSummariesSchema,
    }).map(([name, schema]) => [name, z.toJSONSchema(schema, { io: "input" })]),
  );
}
