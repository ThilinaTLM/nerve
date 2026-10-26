import { z } from "zod";
import { subagentToolNames } from "../tools/subagent-tools.js";
import {
  imageExplanationToolSettingsSchema,
  imageGenerationToolSettingsSchema,
  krokiToolSettingsSchema,
  pythonExecToolSettingsSchema,
  bashToolSettingsSchema,
  planPresentToolSettingsSchema,
} from "../settings/settings.js";
import { userConfigurableToolNameSchema } from "../tools/tool-name.js";

/** Optional tools toggle; bash is always on but has scoped configuration. */
export const capabilityToggleToolNameSchema = z.enum([
  ...userConfigurableToolNameSchema.exclude(subagentToolNames).options,
  "subagents",
  "jira",
  "confluence",
]);
export const capabilityToolNameSchema = z.enum([
  ...capabilityToggleToolNameSchema.options,
  "bash",
]);
export type CapabilityToolName = z.infer<typeof capabilityToolNameSchema>;
const profileIdSchema = z.string().trim().min(1).max(256);
const skillNameSchema = z.string().trim().min(1).max(256);
const skillOverridesSchema = z
  .record(skillNameSchema, z.boolean())
  .refine(
    (value) => Object.keys(value).length <= 512,
    "At most 512 skill overrides are allowed.",
  );
export const capabilitySkillsSchema = z
  .object({
    file: skillOverridesSchema,
    nerve: skillOverridesSchema,
    agentBrowser: skillOverridesSchema,
  })
  .strict();
export type CapabilitySkills = z.infer<typeof capabilitySkillsSchema>;
function payload<S extends z.ZodType>(settings: S) {
  return z
    .object({ enabled: z.boolean().optional(), settings: settings.optional() })
    .strict();
}
const basicPayload = payload(z.never());
const accountPayload = z
  .object({
    enabled: z.boolean().optional(),
    profileId: profileIdSchema.optional(),
  })
  .strict();
/** Canonical per-tool payloads shared by scoped agent preferences and profiles. */
export const capabilityToolPayloadSchemas = {
  python_exec: payload(pythonExecToolSettingsSchema),
  web_search: accountPayload,
  web_fetch: basicPayload,
  explain_image: payload(imageExplanationToolSettingsSchema),
  generate_image: payload(imageGenerationToolSettingsSchema),
  kroki_export: payload(krokiToolSettingsSchema),
  plan_present: payload(planPresentToolSettingsSchema),
  subagents: basicPayload,
  jira: accountPayload,
  confluence: accountPayload,
  bash: z.object({ settings: bashToolSettingsSchema }).strict(),
};
