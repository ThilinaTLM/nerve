import { z } from "zod";
import {
  profileExtensionsSchema,
  type ProfileExtensions,
} from "../extensions/document.js";
import { mcpServerNameSchema } from "../mcp/schemas.js";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/models.js";
import { permissionRuleSetIdSchema } from "../permissions/permission-rule-sets.js";
import {
  agentProfileNameSchema,
  agentProfileInstructionsSchema,
  AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH,
  AGENT_PROFILE_LABEL_MAX_LENGTH,
} from "../agent-profiles/constants.js";
import {
  capabilitySkillsSchema,
  capabilityToolPayloadSchemas,
} from "../capabilities/capabilities.js";
import {
  bashToolSettingsSchema,
  compactionProfileSchema,
  planPresentToolSettingsSchema,
  pythonExecToolSettingsSchema,
} from "../settings/settings.js";

const model = modelSelectionSchema.strict();
const nonempty = (value: object) => Object.keys(value).length > 0;
const compactionDescription =
  "Automatic compaction of the conversation context.";
const retryDescription = "Retry of failed model requests.";
const compaction = z
  .strictObject({
    auto: z
      .boolean()
      .meta({ description: "Compact the conversation automatically." }),
    profile: compactionProfileSchema.meta({
      description:
        "How early automatic compaction triggers. `custom` uses `customTriggerPercent`.",
    }),
    customTriggerPercent: z.number().int().min(60).max(90).meta({
      description:
        "Context usage percent (60-90) that triggers compaction when `profile` is `custom`.",
    }),
  })
  .meta({ description: compactionDescription });
const retry = z
  .strictObject({
    enabled: z.boolean().meta({ description: "Retry failed model requests." }),
    maxRetries: z
      .number()
      .int()
      .nonnegative()
      .meta({ description: "Maximum retries per request." }),
    baseDelayMs: z.number().int().positive().meta({
      description: "Initial delay in milliseconds before the first retry.",
    }),
  })
  .meta({ description: retryDescription });
const bash = bashToolSettingsSchema
  .extend({
    autoPromotion: bashToolSettingsSchema.shape.autoPromotion.strict().meta({
      description:
        "Moves a foreground command that runs too long to the background instead of blocking the agent.",
    }),
    maxTimeoutMs: bashToolSettingsSchema.shape.maxTimeoutMs.removeDefault(),
  })
  .strict();
const sourceDefaultsDescription =
  "Whether skills of each source are enabled unless a per-skill override says otherwise.";
const sourceDefaults = z
  .strictObject({
    file: z.boolean().meta({
      description:
        "Default for skills from files (user and project skill folders).",
    }),
    nerve: z
      .boolean()
      .meta({ description: "Default for Nerve's built-in skills." }),
    agentBrowser: z
      .boolean()
      .meta({ description: "Default for agent-browser skills." }),
  })
  .meta({ description: sourceDefaultsDescription });
const skills = capabilitySkillsSchema
  .partial()
  .extend({
    defaults: sourceDefaults
      .partial()
      .meta({ description: sourceDefaultsDescription })
      .optional(),
  })
  .strict()
  .meta({
    description:
      "Per-skill overrides by source (`file`, `nerve`, `agentBrowser`) and source defaults.",
  });
const mcpServersDescription =
  "Which MCP servers the agent may use, by server name. A named entry beats `defaults`; a server with no decision follows its own `enabled` in mcp.json (default on).";
const mcpServers = z
  .strictObject({
    defaults: z
      .boolean()
      .meta({ description: "Default for servers without a named entry." })
      .optional(),
    servers: z
      .record(mcpServerNameSchema, z.boolean())
      .meta({ description: "Per-server on/off by server name." })
      .optional(),
  })
  .meta({ description: mcpServersDescription });
const toolEntryDescription = "Tool entry; at least one field is required.";
function payload<S extends z.ZodType>(settings: S) {
  return z
    .strictObject({
      enabled: z
        .boolean()
        .meta({ description: "Turn the tool on or off." })
        .optional(),
      settings: settings
        .meta({ description: "Tool settings; include only fields to set." })
        .optional(),
    })
    .refine(nonempty, "Empty tool entry")
    .meta({ description: toolEntryDescription });
}
const toggle = z
  .strictObject({
    enabled: z.boolean().meta({ description: "Turn the tool on or off." }),
  })
  .meta({ description: "Tool toggle." });
const childToolShape = {
  python_exec: payload(pythonExecToolSettingsSchema.partial()),
  web_search: toggle,
  quick_script: toggle,
  web_fetch: toggle,
  bash: z
    .strictObject({
      settings: bash.partial().refine(nonempty).meta({
        description:
          "Shell settings; include only fields to set, at least one. The bash tool is always on.",
      }),
    })
    .meta({ description: toolEntryDescription }),
};
const leadTools = z
  .strictObject({
    ...childToolShape,
    plan_present: payload(
      planPresentToolSettingsSchema.partial().refine(nonempty),
    ),
    subagents: toggle.meta({
      description: "Delegation to sub-agents on or off (lead only).",
    }),
  })
  .partial()
  .meta({
    description:
      "Tool toggles and settings by tool name. Every entry must be non-empty.",
  });
const childTools = z.strictObject(childToolShape).partial().meta({
  description:
    "Tool toggles and settings by tool name. Every entry must be non-empty.",
});
const launch = z.strictObject({
  model: model
    .meta({ description: "Model this sub-agent launches with." })
    .optional(),
  reasoningLevel: thinkingLevelSchema.optional(),
});
export const childLaunchOverridesSchema = launch;
const subagent = launch
  .extend({
    enabled: z
      .boolean()
      .meta({
        description:
          "Make this sub-agent profile available to the lead or not.",
      })
      .optional(),
  })
  .refine(nonempty)
  .meta({
    description:
      "Launch settings for one sub-agent profile. At least one field is required.",
  });
const childShape = {
  model: model
    .meta({
      description:
        "Model to use. Take `provider` and `modelId` from the user's configured models.",
    })
    .optional(),
  reasoningLevel: thinkingLevelSchema.optional(),
  permissionRuleSetId: permissionRuleSetIdSchema
    .meta({
      description:
        "Id of a built-in or user permission rule set. Sub-agents need a rule set without `prompt` rules.",
    })
    .optional(),
  compaction: compaction
    .partial()
    .meta({ description: compactionDescription })
    .optional(),
  retry: retry.partial().meta({ description: retryDescription }).optional(),
  tools: childTools.optional(),
  skills: skills.optional(),
  mcpServers: mcpServers.optional(),
};
export const childSettingsOverridesSchema = z.strictObject(childShape);
export const leadSettingsOverridesSchema = z.strictObject({
  ...childShape,
  tools: leadTools.optional(),
  subagents: z
    .record(agentProfileNameSchema, subagent)
    .meta({
      description:
        "Lead only. Launch settings by sub-agent profile name: turn a teammate on or off or give it a model.",
    })
    .optional(),
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
  // Optional: configurations frozen before this tool existed omit it (= off).
  quick_script: capabilityToolPayloadSchemas.quick_script
    .required({ enabled: true })
    .optional(),
  web_fetch: toggle,
  bash: z.strictObject({ settings: bash }),
});
export const completeChildSettingsSchema = childSettingsOverridesSchema.extend({
  reasoningLevel: thinkingLevelSchema,
  permissionRuleSetId: permissionRuleSetIdSchema,
  compaction,
  retry,
  tools: completeTools,
  skills: capabilitySkillsSchema.extend({ defaults: sourceDefaults }).strict(),
  // Optional: configurations frozen before MCP settings existed omit it.
  mcpServers: mcpServers.optional(),
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
const profileSettingsOverridesSchema = leadSettingsOverridesSchema.extend({
  skills: capabilitySkillsSchema
    .partial()
    .strict()
    .meta({
      description:
        "Per-skill overrides by source (`file`, `nerve`, `agentBrowser`). Profiles cannot set `defaults`.",
    })
    .optional(),
  mcpServers: z
    .strictObject({
      servers: z
        .record(mcpServerNameSchema, z.boolean())
        .meta({ description: "Per-server on/off by server name." })
        .optional(),
    })
    .meta({
      description:
        "Per-server overrides by server name. Profiles cannot set `defaults`.",
    })
    .optional(),
});
export const appliedProfileSchema = z
  .strictObject({
    ...contribution,
    recommendations: profileSettingsOverridesSchema,
    requirements: profileSettingsOverridesSchema,
    extensions: profileExtensionsSchema.optional(),
  })
  .superRefine(checkOverlap);
export type AppliedProfile = z.infer<typeof appliedProfileSchema>;
export const agentPreferencesSchema = z
  .strictObject({
    schemaVersion: z.literal(1).meta({ description: "Always 1." }),
    revision: revision.meta({
      description: "Write counter managed by Nerve. Keep the existing value.",
    }),
    overrides: leadSettingsOverridesSchema.meta({
      description:
        "Settings object. Every field is optional; an omitted field falls back to the lower layer.",
    }),
  })
  .meta({
    description:
      "Agent preferences (`agent.json`) at user or project scope: default model, reasoning, permissions, tools and skills.",
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
    schemaVersion: z.literal(1).meta({ description: "Always 1." }),
    name: agentProfileNameSchema.meta({
      description:
        "Profile name; equals the file name without `.json`. Lowercase letters and digits in hyphen-separated words, at most 32 characters.",
    }),
    label: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_PROFILE_LABEL_MAX_LENGTH)
      .meta({ description: "Display name, 1-80 characters." })
      .optional(),
    whenToUse: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH)
      .meta({
        description:
          "1-200 characters. Sub-agent profiles: the line the lead chooses the teammate by; name the kind of task and the outcome.",
      }),
    /** Authored launch default (true if omitted), not availability or a requirement. */
    enabled: z
      .boolean()
      .meta({
        description:
          "Sub-agent profiles: `false` makes the profile unavailable to leads by default; the user can enable it per conversation. Default `true`.",
      })
      .optional(),
    usableBy: z.enum(["lead", "subagent", "both"]).meta({
      description:
        "Who may use the profile. `subagent` and `both` profiles may only use settings that sub-agents support.",
    }),
    instructions: agentProfileInstructionsSchema.meta({
      description:
        "Text added to the agent's system prompt, at most 16384 UTF-8 bytes. May be empty for a settings-only profile.",
    }),
    recommendations: profileSettingsOverridesSchema
      .meta({
        description:
          "Settings object: values used unless the conversation chooses otherwise.",
      })
      .optional(),
    requirements: profileSettingsOverridesSchema
      .meta({
        description:
          "Settings object: values enforced while the profile is applied. The same setting may not appear in both `recommendations` and `requirements`.",
      })
      .optional(),
    /** Extension entries the profile recommends or requires (locks) in the conversation. */
    extensions: profileExtensionsSchema
      .meta({
        description:
          "Extension entries the profile recommends or requires, by extension id. Use only when asked, with the extension's documented settings.",
      })
      .optional(),
  })
  .meta({
    description:
      "Agent profile file. Not expressible here: `recommendations` and `requirements` must not set the same setting (also `extensions.<id>.settings.<key>` and `enabled`). A `subagent` or `both` profile may not use `tools.plan_present`, `tools.subagents` or `subagents`.",
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
    if (
      (x.startsWith("/mcpServers/defaults") &&
        y.startsWith("/mcpServers/servers/")) ||
      (y.startsWith("/mcpServers/defaults") &&
        x.startsWith("/mcpServers/servers/"))
    )
      return true;
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
/** Extension fields (and enablement) a profile both recommends and requires. */
export function extensionOverlaps(extensions?: ProfileExtensions): string[] {
  const overlaps: string[] = [];
  for (const [id, required] of Object.entries(extensions?.requirements ?? {})) {
    const recommended = extensions?.recommendations?.[id];
    if (!recommended) continue;
    if (recommended.enabled !== undefined && required.enabled !== undefined)
      overlaps.push(`/extensions/${id}/enabled`);
    for (const key of Object.keys(required.settings ?? {}))
      if (recommended.settings && Object.hasOwn(recommended.settings, key))
        overlaps.push(`/extensions/${id}/settings/${key}`);
  }
  return overlaps;
}
function checkOverlap(
  v: {
    recommendations?: LeadSettingsOverrides;
    requirements?: LeadSettingsOverrides;
    extensions?: ProfileExtensions;
  },
  ctx: z.RefinementCtx,
) {
  for (const pointer of extensionOverlaps(v.extensions))
    ctx.addIssue({
      code: "custom",
      path: ["extensions", "requirements"],
      message: `Recommendation/requirement overlap: ${pointer}`,
    });
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
