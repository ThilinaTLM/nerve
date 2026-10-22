import { z } from "zod";
import { agentProfileSettingSchema } from "./scalar.js";
import { permissionRuleSetIdSchema } from "../permissions/permission-rule-sets.js";
import {
  capabilityToolPayloadSchemas,
  capabilitySkillsSchema,
} from "../capabilities/capabilities.js";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import { autoCompactionSettingsSchema } from "../settings/settings.js";
import {
  AGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
  AGENT_PROFILE_LABEL_MAX_LENGTH,
  agentProfileInstructionsSchema,
  agentProfileNameSchema,
} from "./constants.js";

export const agentProfileSourceSchema = z.enum(["builtin", "user", "project"]);
export type AgentProfileSource = z.infer<typeof agentProfileSourceSchema>;
export const agentProfileScopeSchema = z.enum(["user", "project"]);
export type AgentProfileScope = z.infer<typeof agentProfileScopeSchema>;
export const agentProfileUsableBySchema = z.enum(["lead", "subagent", "both"]);
export type AgentProfileUsableBy = z.infer<typeof agentProfileUsableBySchema>;

/** Model/thinking share a UI picker, but remain independent template settings. */
export const agentProfileModelSchema = agentProfileSettingSchema(
  modelSelectionSchema.strict(),
);
export type AgentProfileModel = z.infer<typeof agentProfileModelSchema>;
export const agentProfileThinkingSchema =
  agentProfileSettingSchema(thinkingLevelSchema);
export type AgentProfileThinking = z.infer<typeof agentProfileThinkingSchema>;
export const agentProfilePermissionSchema = agentProfileSettingSchema(
  permissionRuleSetIdSchema,
);
export type AgentProfilePermission = z.infer<
  typeof agentProfilePermissionSchema
>;
export const agentProfileCompactionSchema = agentProfileSettingSchema(
  autoCompactionSettingsSchema,
);
export type AgentProfileCompaction = z.infer<
  typeof agentProfileCompactionSchema
>;

export const agentProfileToolsSchema = z
  .object({
    python_exec: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.python_exec,
    ).optional(),
    web_search: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.web_search,
    ).optional(),
    web_fetch: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.web_fetch,
    ).optional(),
    explain_image: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.explain_image,
    ).optional(),
    generate_image: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.generate_image,
    ).optional(),
    kroki_export: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.kroki_export,
    ).optional(),
    plan_present: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.plan_present,
    ).optional(),
    subagents: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.subagents,
    ).optional(),
    jira: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.jira,
    ).optional(),
    confluence: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.confluence,
    ).optional(),
    bash: agentProfileSettingSchema(
      capabilityToolPayloadSchemas.bash,
    ).optional(),
  })
  .strict();
export type AgentProfileTools = z.infer<typeof agentProfileToolsSchema>;
export const agentProfileSkillNameSchema = z.string().trim().min(1).max(256);
/** None disables all discovered skills; otherwise use the canonical source buckets. */
export const agentProfileSkillsValueSchema = z.union([
  z.literal("none"),
  capabilitySkillsSchema,
]);
export type AgentProfileSkillsValue = z.infer<
  typeof agentProfileSkillsValueSchema
>;
export const agentProfileSkillsSchema = agentProfileSettingSchema(
  agentProfileSkillsValueSchema,
);
export type AgentProfileSkills = z.infer<typeof agentProfileSkillsSchema>;
export const agentProfileFieldsSchema = z
  .object({
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
    enabled: z.boolean().optional(),
    usableBy: agentProfileUsableBySchema,
    model: agentProfileModelSchema.optional(),
    thinking: agentProfileThinkingSchema.optional(),
    permission: agentProfilePermissionSchema.optional(),
    compaction: agentProfileCompactionSchema.optional(),
    tools: agentProfileToolsSchema.optional(),
    skills: agentProfileSkillsSchema.optional(),
  })
  .strict();
export function validateProfileLeadSettings(
  value: {
    usableBy?: string;
    model?: unknown;
    thinking?: unknown;
    permission?: unknown;
    compaction?: unknown;
    skills?: unknown;
    tools?: Record<string, unknown>;
  },
  ctx: z.RefinementCtx,
) {
  if (value.usableBy !== "lead") return;
  for (const field of [
    "model",
    "thinking",
    "permission",
    "compaction",
    "skills",
  ] as const)
    if (value[field] === "lead")
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: "Same as lead is only valid for sub-agent-usable profiles.",
      });
  for (const [name, setting] of Object.entries(value.tools ?? {}))
    if (setting === "lead")
      ctx.addIssue({
        code: "custom",
        path: ["tools", name],
        message: "Same as lead is only valid for sub-agent-usable profiles.",
      });
}
export const agentProfileDraftSchema = agentProfileFieldsSchema
  .extend({
    name: agentProfileNameSchema,
    instructions: agentProfileInstructionsSchema,
  })
  .strict()
  .superRefine(validateProfileLeadSettings);
export type AgentProfileDraft = z.infer<typeof agentProfileDraftSchema>;
export const agentProfileTrustSchema = z.enum(["trusted", "untrusted"]);
export type AgentProfileTrust = z.infer<typeof agentProfileTrustSchema>;
export const agentProfileSchema = agentProfileFieldsSchema
  .extend({
    name: agentProfileNameSchema,
    label: z.string().min(1),
    enabled: z.boolean(),
    tools: agentProfileToolsSchema,
    instructions: agentProfileInstructionsSchema,
    source: agentProfileSourceSchema,
    path: z.string().min(1).optional(),
    digest: z.string().min(1).optional(),
    trust: agentProfileTrustSchema.optional(),
    error: z.string().optional(),
  })
  .superRefine(validateProfileLeadSettings);
export type AgentProfile = z.infer<typeof agentProfileSchema>;
