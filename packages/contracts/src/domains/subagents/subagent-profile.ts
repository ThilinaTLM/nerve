import { z } from "zod";
import { subagentRecordSchema } from "./record-schema.js";
import {
  capabilityToolNameSchema,
  capabilityToolSettingsSchema,
} from "../capabilities/capabilities.js";
import { toolNameSchema } from "../tools/tool-name.js";
import { thinkingLevelSchema } from "../models/models.js";
import { compactionProfileSchema } from "../settings/settings.js";
import {
  SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
  SUBAGENT_PROFILE_LABEL_MAX_LENGTH,
  subagentInstructionsSchema,
  subagentPermissionRuleSetIdSchema,
  subagentProfileNameSchema,
} from "./constants.js";

export const subagentProfileSourceSchema = z.enum([
  "builtin",
  "user",
  "project",
  "conversation",
]);
export type SubagentProfileSource = z.infer<typeof subagentProfileSourceSchema>;

export const subagentProfileScopeSchema = z.enum([
  "user",
  "project",
  "conversation",
]);
export type SubagentProfileScope = z.infer<typeof subagentProfileScopeSchema>;

/** `lead` copies the lead's model at creation; otherwise `<provider>/<modelId>`. */
export const subagentProfileModelSchema = z.union([
  z.literal("lead"),
  z.string().regex(/^[^/\s]+\/\S+$/, 'Use "lead" or "<provider>/<modelId>"'),
]);
export type SubagentProfileModel = z.infer<typeof subagentProfileModelSchema>;

export const subagentProfileThinkingSchema = z.union([
  z.literal("lead"),
  thinkingLevelSchema,
]);
export type SubagentProfileThinking = z.infer<
  typeof subagentProfileThinkingSchema
>;

const subagentCompactionOverrideObjectSchema = z
  .object({
    auto: z.boolean().optional(),
    profile: compactionProfileSchema,
    triggerPercent: z.number().int().min(60).max(90).optional(),
  })
  .strict();

/** Compaction materialized as the child's conversation override. */
export const subagentCompactionOverrideSchema = z.preprocess(
  (value: z.input<typeof subagentCompactionOverrideObjectSchema>) => {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return value;
    // Keep old profile documents readable without allowing other unknown keys.
    const compaction: Record<string, unknown> = { ...value };
    delete compaction.keepRecentPercent;
    return compaction;
  },
  subagentCompactionOverrideObjectSchema,
);
export type SubagentCompactionOverride = z.infer<
  typeof subagentCompactionOverrideSchema
>;
export const subagentProfileCompactionSchema = z.union([
  z.literal("inherit"),
  subagentCompactionOverrideSchema,
]);
export type SubagentProfileCompaction = z.infer<
  typeof subagentProfileCompactionSchema
>;

/** Keys are capability tool names, as in `capabilities.json`; core tools are governed by permissions. */
const allowedToolKeys: ReadonlySet<string> = new Set(
  capabilityToolNameSchema.options.filter((name) => name !== "subagents"),
);
const toolSettingsSchemas: Record<string, z.ZodType> =
  capabilityToolSettingsSchema.shape;

/**
 * Changes from the lead's effective capability tools: `<tool>: false` removes,
 * `true` adds one the lead has disabled, an object replaces that tool's settings.
 */
export const subagentProfileToolsSchema = subagentRecordSchema(
  z.string().min(1).max(64),
  z.union([z.boolean(), subagentRecordSchema(z.string(), z.unknown())]),
).superRefine((tools, context) => {
  for (const [name, value] of Object.entries(tools)) {
    if (
      !allowedToolKeys.has(name) &&
      (toolNameSchema.safeParse(name).success ||
        name === "subagents" ||
        name === "fileEditing")
    ) {
      context.addIssue({
        code: "custom",
        path: [name],
        message: `Forbidden or non-configurable tool ${name}`,
      });
      continue;
    }
    if (!allowedToolKeys.has(name) || typeof value === "boolean") continue;
    const settings = toolSettingsSchemas[name];
    if (!settings) {
      context.addIssue({
        code: "custom",
        path: [name],
        message: `Tool ${name} has no settings; use true or false`,
      });
      continue;
    }
    const parsed = settings.safeParse(value);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({
          code: "custom",
          path: [name, ...issue.path],
          message: issue.message,
        });
  }
});
export type SubagentProfileTools = z.infer<typeof subagentProfileToolsSchema>;

export const subagentSkillNameSchema = z.string().trim().min(1).max(256);
/** `inherit` the lead's skills, `none`, or per-skill changes from the lead's set. */
export const subagentProfileSkillsSchema = z.union([
  z.literal("inherit"),
  z.literal("none"),
  subagentRecordSchema(subagentSkillNameSchema, z.boolean()),
]);
export type SubagentProfileSkills = z.infer<typeof subagentProfileSkillsSchema>;

/** Complete profile settings, excluding the name and instructions. */
export const subagentProfileFieldsSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(SUBAGENT_PROFILE_LABEL_MAX_LENGTH)
      .optional(),
    description: z
      .string()
      .trim()
      .min(1)
      .max(SUBAGENT_PROFILE_DESCRIPTION_MAX_LENGTH),
    enabled: z.boolean().optional(),
    model: subagentProfileModelSchema,
    thinking: subagentProfileThinkingSchema,
    permission: subagentPermissionRuleSetIdSchema,
    compaction: subagentProfileCompactionSchema,
    tools: subagentProfileToolsSchema.optional(),
    skills: subagentProfileSkillsSchema,
  })
  .strict();
export type SubagentProfileFields = z.infer<typeof subagentProfileFieldsSchema>;

/** A complete editable profile, used for replacement, copying and duplication. */
export const subagentProfileDraftSchema = subagentProfileFieldsSchema
  .extend({
    name: subagentProfileNameSchema,
    instructions: subagentInstructionsSchema,
  })
  .strict();
export type SubagentProfileDraft = z.infer<typeof subagentProfileDraftSchema>;

export const subagentProfileTrustSchema = z.enum(["trusted", "untrusted"]);
export type SubagentProfileTrust = z.infer<typeof subagentProfileTrustSchema>;

/**
 * A resolved creation-time template for UI and server. Blocking diagnostics
 * also populate `error`; blocked profiles must never be offered to the lead.
 */
export const subagentProfileSchema = z.object({
  name: subagentProfileNameSchema,
  label: z.string().min(1),
  description: z.string(),
  enabled: z.boolean(),
  source: subagentProfileSourceSchema,
  model: subagentProfileModelSchema,
  thinking: subagentProfileThinkingSchema,
  permission: subagentPermissionRuleSetIdSchema,
  compaction: subagentProfileCompactionSchema,
  tools: subagentProfileToolsSchema,
  skills: subagentProfileSkillsSchema,
  instructions: z.string(),
  path: z.string().min(1).optional(),
  digest: z.string().min(1).optional(),
  /** Trust of all contributing entries, including project overrides inherited by conversation scope. */
  trust: subagentProfileTrustSchema.optional(),
  error: z.string().optional(),
});
export type SubagentProfile = z.infer<typeof subagentProfileSchema>;

export type BuiltInSubagentProfile = SubagentProfileDraft & {
  label: string;
  enabled: boolean;
};

const exploreInstructions = `You are a read-only researcher. Investigate the assignment and report what you find; do not modify files.

- Search and read the codebase, and use the web when the assignment needs it.
- Stay within the assignment. Prefer a few targeted searches over exhaustive reading.
- Back every claim with evidence: file paths with line numbers, command output, or URLs.
- Say plainly when something could not be found or is uncertain.

End with a short report using these headings: Summary, Relevant files, Evidence, Open questions.`;

const developerInstructions = `You are a developer working in a shared worktree on an assigned scope. Other agents may be editing other files at the same time.

- Stay within the assigned scope. If the work needs changes outside it, report that instead of making them.
- Never revert, overwrite or reformat changes you did not make.
- Run the tests and checks relevant to your changes, and fix what you broke.
- Do not commit unless the assignment says so.

End with a short report using these headings: Changes (files and what changed), Validation (what you ran and the results), Left to do (anything unfinished or needing a decision).`;

export const builtInSubagentProfiles: readonly BuiltInSubagentProfile[] = [
  {
    name: "explore",
    label: "Explore",
    description:
      "Read-only codebase and web research; returns a report with paths and evidence.",
    enabled: true,
    model: "lead",
    thinking: "lead",
    permission: "read_only",
    compaction: "inherit",
    skills: "none",
    instructions: exploreInstructions,
  },
  {
    name: "developer",
    label: "Developer",
    description:
      "Implements, tests and fixes code in the shared worktree within an assigned scope.",
    enabled: true,
    model: "lead",
    thinking: "lead",
    permission: "autonomous",
    compaction: "inherit",
    skills: "inherit",
    instructions: developerInstructions,
  },
];
