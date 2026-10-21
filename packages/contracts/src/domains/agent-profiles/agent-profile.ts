import { agentProfileScalarSchema } from "./scalar.js";
import { permissionRuleSetIdSchema } from "../permissions/permission-rule-sets.js";
import { z } from "zod";
import { agentProfileRecordSchema } from "./record-schema.js";
import {
  capabilityToolNameSchema,
  capabilityToolSettingsSchema,
} from "../capabilities/capabilities.js";
import { toolNameSchema } from "../tools/tool-name.js";
import { thinkingLevelSchema } from "../models/models.js";
import { compactionProfileSchema } from "../settings/settings.js";
import {
  AGENT_PROFILE_DESCRIPTION_MAX_LENGTH,
  AGENT_PROFILE_LABEL_MAX_LENGTH,
  agentProfileInstructionsSchema,
  agentProfileNameSchema,
} from "./constants.js";

export const agentProfileSourceSchema = z.enum([
  "builtin",
  "user",
  "project",
  "conversation",
]);
export type AgentProfileSource = z.infer<typeof agentProfileSourceSchema>;

export const agentProfileScopeSchema = z.enum([
  "user",
  "project",
  "conversation",
]);
export type AgentProfileScope = z.infer<typeof agentProfileScopeSchema>;

export const agentProfileUsableBySchema = z.enum(["lead", "subagent", "both"]);
export type AgentProfileUsableBy = z.infer<typeof agentProfileUsableBySchema>;

export const agentProfileModelSchema = agentProfileScalarSchema(
  z.string().regex(/^[^/\s]+\/\S+$/, 'Use "<provider>/<modelId>"'),
);
export type AgentProfileModel = z.infer<typeof agentProfileModelSchema>;
export const agentProfileThinkingSchema =
  agentProfileScalarSchema(thinkingLevelSchema);
export type AgentProfileThinking = z.infer<typeof agentProfileThinkingSchema>;
export const agentProfilePermissionSchema = agentProfileScalarSchema(
  permissionRuleSetIdSchema.refine(
    (value) => value !== "inherit" && value !== "default",
    "Reserved scalar keyword",
  ),
);
export type AgentProfilePermission = z.infer<
  typeof agentProfilePermissionSchema
>;

/** Concrete compaction override, shared by profile settings and turn-time locks. */
export const agentProfileCompactionOverrideSchema = z
  .object({
    auto: z.boolean().optional(),
    profile: compactionProfileSchema,
    triggerPercent: z.number().int().min(60).max(90).optional(),
  })
  .strict();
export type AgentProfileCompactionOverride = z.infer<
  typeof agentProfileCompactionOverrideSchema
>;
export const agentProfileCompactionSchema = agentProfileScalarSchema(
  agentProfileCompactionOverrideSchema,
);
export type AgentProfileCompaction = z.infer<
  typeof agentProfileCompactionSchema
>;

/** Keys are capability tool names, as in `capabilities.json`; core tools are governed by permissions. */
const allowedToolKeys: ReadonlySet<string> = new Set(
  capabilityToolNameSchema.options.filter((name) => name !== "subagents"),
);
const toolSettingsSchemas: Record<string, z.ZodType> =
  capabilityToolSettingsSchema.shape;

/**
 * Changes from the parent context's effective capability tools: `<tool>: false` removes,
 * `true` adds one the lead has disabled, an object replaces that tool's settings.
 */
export const agentProfileToolsSchema = agentProfileRecordSchema(
  z.string().min(1).max(64),
  z.union([z.boolean(), agentProfileRecordSchema(z.string(), z.unknown())]),
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
export type AgentProfileTools = z.infer<typeof agentProfileToolsSchema>;

export const agentProfileSkillNameSchema = z.string().trim().min(1).max(256);
/** `inherit` the parent context's skills, `none`, or per-skill changes from the parent context's set. */
export const agentProfileSkillsSchema = z.union([
  z.literal("inherit"),
  z.literal("none"),
  agentProfileRecordSchema(agentProfileSkillNameSchema, z.boolean()),
]);
export type AgentProfileSkills = z.infer<typeof agentProfileSkillsSchema>;

/** Complete profile settings, excluding the name and instructions. */
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
    model: agentProfileModelSchema,
    thinking: agentProfileThinkingSchema,
    permission: agentProfilePermissionSchema,
    compaction: agentProfileCompactionSchema,
    tools: agentProfileToolsSchema.optional(),
    skills: agentProfileSkillsSchema,
  })
  .strict();
export type AgentProfileFields = z.infer<typeof agentProfileFieldsSchema>;

/** A complete editable profile, used for replacement, copying and duplication. */
export const agentProfileDraftSchema = agentProfileFieldsSchema
  .extend({
    name: agentProfileNameSchema,
    instructions: agentProfileInstructionsSchema,
  })
  .strict();
export type AgentProfileDraft = z.infer<typeof agentProfileDraftSchema>;

export const agentProfileTrustSchema = z.enum(["trusted", "untrusted"]);
export type AgentProfileTrust = z.infer<typeof agentProfileTrustSchema>;

/**
 * A resolved profile for UI and server. Blocking diagnostics
 * also populate `error`; blocked profiles must never be offered to the lead.
 */
export const agentProfileSchema = z.object({
  name: agentProfileNameSchema,
  label: z.string().min(1),
  description: z.string(),
  enabled: z.boolean(),
  source: agentProfileSourceSchema,
  usableBy: agentProfileUsableBySchema,
  model: agentProfileModelSchema,
  thinking: agentProfileThinkingSchema,
  permission: agentProfilePermissionSchema,
  compaction: agentProfileCompactionSchema,
  tools: agentProfileToolsSchema,
  skills: agentProfileSkillsSchema,
  instructions: z.string(),
  path: z.string().min(1).optional(),
  digest: z.string().min(1).optional(),
  /** Trust of all contributing entries, including project overrides inherited by conversation scope. */
  trust: agentProfileTrustSchema.optional(),
  error: z.string().optional(),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export type BuiltInAgentProfile = AgentProfileDraft & {
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

export const builtInAgentProfiles: readonly BuiltInAgentProfile[] = [
  {
    name: "coding",
    label: "Coding",
    description: "Implement and validate changes.",
    usableBy: "lead",
    enabled: true,
    model: "inherit",
    thinking: "inherit",
    permission: "default",
    compaction: "inherit",
    skills: "inherit",
    instructions:
      "In the final response, summarize changes, validation, and remaining limits.",
  },
  {
    name: "planning",
    label: "Planning",
    description: "Research and present an implementation plan.",
    usableBy: "lead",
    enabled: true,
    model: "inherit",
    thinking: "inherit",
    permission: { lock: "planning" },
    compaction: "inherit",
    tools: { plan_present: true },
    skills: "inherit",
    instructions:
      "Before anything else, read {{skill:planning}} and follow it.",
  },
  {
    name: "explore",
    usableBy: "subagent",
    label: "Explore",
    description:
      "Read-only codebase and web research; returns a report with paths and evidence.",
    enabled: true,
    model: "inherit",
    thinking: "inherit",
    permission: "read_only",
    compaction: "inherit",
    skills: "none",
    instructions: exploreInstructions,
  },
  {
    name: "developer",
    usableBy: "subagent",
    label: "Developer",
    description:
      "Implements, tests and fixes code in the shared worktree within an assigned scope.",
    enabled: true,
    model: "inherit",
    thinking: "inherit",
    permission: "autonomous",
    compaction: "inherit",
    skills: "inherit",
    instructions: developerInstructions,
  },
];
