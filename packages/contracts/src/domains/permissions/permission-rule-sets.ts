import { trustStateSchema } from "../core/trust-state.js";
import { z } from "zod";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/);
const boundedStringSchema = z.string().trim().min(1).max(256);
const primitiveValueSchema = z.union([
  z.string().max(8_192),
  z.number().finite(),
  z.boolean(),
]);

export const permissionDecisionSchema = z
  .enum(["allow", "prompt", "deny"])
  .meta({
    description:
      "`allow` runs the call, `prompt` asks the user, `deny` refuses it.",
  });
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export type RuleDecision = PermissionDecision;

export const ruleEnforcementSchema = z.enum(["overridable", "guardrail"]).meta({
  description:
    "`overridable` rules are ordered by scope and priority. A `guardrail` beats every overridable rule, may only `prompt` or `deny`, and is allowed only in user overlays.",
});
export type RuleEnforcement = z.infer<typeof ruleEnforcementSchema>;

export const toolKindSchema = z
  .enum([
    "filesystem",
    "command",
    "code",
    "external_read",
    "interaction",
    "orchestration",
    "deployment",
    "integration",
    "other",
  ])
  .meta({ description: "Static category of a tool." });
export type ToolKind = z.infer<typeof toolKindSchema>;

/**
 * Static category of a tool (what rule sets match on). The effective risk of a
 * specific call is `ToolRisk`; map with `effectiveRiskForCategory`.
 */
export const staticToolRiskSchema = z
  .enum([
    "read",
    "write",
    "external_read",
    "external_write",
    "secret",
    "destructive",
    "deployment",
    "agent_spawn",
    "interaction",
    "unknown",
  ])
  .meta({
    description:
      "Risk class of a tool call. `bash` and `python_exec` calls are always `unknown`; match them by tool name and argument.",
  });
export type StaticToolRisk = z.infer<typeof staticToolRiskSchema>;

export const permissionTargetKindSchema = z
  .enum(["path", "url", "agent", "resource", "whole_tool"])
  .meta({ description: "Kind of target a call touches." });
export type PermissionTargetKind = z.infer<typeof permissionTargetKindSchema>;

export const pathRootSchema = z
  .enum(["project", "nerve_home", "nerve_data", "plans"])
  .meta({
    description:
      "Directory a path target is relative to: the project directory, the Nerve home, its data directory or the plans directory.",
  });
export type PathRoot = z.infer<typeof pathRootSchema>;

const relativePathSchema = z
  .string()
  .max(4_096)
  .superRefine((value, context) => {
    if (
      value.includes("\\") ||
      value.startsWith("/") ||
      /^[A-Za-z]:/.test(value) ||
      value.split("/").includes("..") ||
      value.includes("\0")
    ) {
      context.addIssue({
        code: "custom",
        message: "Paths must be normalized root-relative POSIX paths.",
      });
    }
  });

const rootedPermissionPathTargetSchema = z
  .object({
    kind: z.literal("path"),
    access: z.enum(["read", "write"]),
    scope: z.enum(["exact", "tree"]),
    root: pathRootSchema,
    relativePath: relativePathSchema,
  })
  .strict();

const absolutePathSchema = z
  .string()
  .min(1)
  .max(32_768)
  .superRefine((value, context) => {
    if (
      value.includes("\0") ||
      (!value.startsWith("/") &&
        !/^[A-Za-z]:[\\/]/.test(value) &&
        !value.startsWith("\\\\"))
    ) {
      context.addIssue({
        code: "custom",
        message: "External path targets must use absolute platform paths.",
      });
    }
  });

const externalPermissionPathTargetSchema = z
  .object({
    kind: z.literal("path"),
    access: z.enum(["read", "write"]),
    scope: z.enum(["exact", "tree"]),
    absolutePath: absolutePathSchema,
  })
  .strict();

export const permissionTargetSchema = z.union([
  rootedPermissionPathTargetSchema,
  externalPermissionPathTargetSchema,
  z
    .object({
      kind: z.literal("url"),
      normalizedUrl: z.string().url().max(8_192),
      access: z.enum(["read", "write"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("agent"),
      agentId: boundedStringSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("resource"),
      /** Normalized `<system>:<type>/<id>`, e.g. `jira:issue/APP-12`. */
      value: z.string().trim().min(1).max(2_048),
    })
    .strict(),
  z.object({ kind: z.literal("whole_tool") }).strict(),
]);
export type PermissionTarget = z.infer<typeof permissionTargetSchema>;

export const comparableValueSchema = z
  .union([primitiveValueSchema, z.array(primitiveValueSchema).max(256)])
  .meta({
    description: "String, number, boolean or an array of those (at most 256).",
  });
export type PrimitiveValue = z.infer<typeof primitiveValueSchema>;
export type ComparableValue = z.infer<typeof comparableValueSchema>;

const operatorDescription =
  "Operators: `equals`/`not_equals` compare the whole value; `in` matches any listed value; `glob` matches a pattern against the whole value (`*` stays within one `/` segment, `**` spans segments, `{a,b}` alternates); `exists` tests presence (`value` true or false).";
const inValuesSchema = z
  .array(primitiveValueSchema)
  .min(1)
  .max(256)
  .meta({ description: "Values to match; the call matches any of them." });
const globValueSchema = z
  .string()
  .max(8_192)
  .meta({ description: "Glob pattern, matched against the whole value." });
export const valueMatcherSchema = z
  .discriminatedUnion("operator", [
    z
      .object({
        operator: z.enum(["equals", "not_equals"]),
        value: comparableValueSchema,
      })
      .strict(),
    z
      .object({
        operator: z.literal("in"),
        value: inValuesSchema,
      })
      .strict(),
    z
      .object({
        operator: z.literal("glob"),
        value: globValueSchema,
      })
      .strict(),
    z
      .object({
        operator: z.literal("exists"),
        value: z.boolean().meta({
          description: "`true` matches when present, `false` when absent.",
        }),
      })
      .strict(),
  ])
  .meta({
    description: `Compares a single value, such as the tool's primary argument. ${operatorDescription} Command lines are one value, so a glob like \`pnpm test*\` also matches \`pnpm test && rm -rf x\`; prefer \`equals\` or \`in\` for commands.`,
  });
export type ValueMatcher = z.infer<typeof valueMatcherSchema>;

const argumentPathSchema = z
  .string()
  .min(6)
  .max(512)
  .regex(/^args\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
  .meta({
    description:
      "Path to a tool argument: `args.<name>` or nested `args.<name>.<name>`.",
  });
export const argumentMatcherSchema = z
  .discriminatedUnion("operator", [
    z
      .object({
        path: argumentPathSchema,
        operator: z.enum(["equals", "not_equals"]),
        value: comparableValueSchema,
      })
      .strict(),
    z
      .object({
        path: argumentPathSchema,
        operator: z.literal("in"),
        value: inValuesSchema,
      })
      .strict(),
    z
      .object({
        path: argumentPathSchema,
        operator: z.literal("glob"),
        value: globValueSchema,
      })
      .strict(),
    z
      .object({
        path: argumentPathSchema,
        operator: z.literal("exists"),
        value: z.boolean().meta({
          description: "`true` matches when present, `false` when absent.",
        }),
      })
      .strict(),
  ])
  .meta({
    description: `Compares one named argument of the tool call. ${operatorDescription}`,
  });
export type ArgumentMatcher = z.infer<typeof argumentMatcherSchema>;

const targetPatternSchema = z
  .string()
  .max(8_192)
  .meta({
    description:
      "Single-line glob over the path relative to its root, the full URL, the agent id or the resource value. Path patterns are relative POSIX globs: no leading `/`, no `..`, no backslashes.",
  })
  .superRefine((value, context) => {
    if (/\r|\n|\0/.test(value)) {
      context.addIssue({
        code: "custom",
        message: "Target patterns must be a single line.",
      });
    }
  });

export const targetMatcherSchema = z
  .object({
    kind: permissionTargetKindSchema.optional(),
    access: z
      .enum(["read", "write"])
      .meta({ description: "Whether the call reads or writes the target." })
      .optional(),
    scope: z
      .enum(["exact", "tree"])
      .meta({
        description:
          "Paths only: `exact` for one file, `tree` for a directory and everything below it.",
      })
      .optional(),
    root: pathRootSchema
      .meta({
        description:
          "Paths only: `project` (the project directory), `nerve_home`, `nerve_data` or `plans`. A path outside every root has no root and matches only matchers without `root` and `pattern`.",
      })
      .optional(),
    pattern: targetPatternSchema.optional(),
  })
  .strict()
  .meta({
    description:
      "Matches one target of a call. Every present field must match. `scope` and `root` need `kind` `path` or no `kind`.",
  })
  .superRefine((matcher, context) => {
    const hasPathField =
      matcher.scope !== undefined || matcher.root !== undefined;
    if (hasPathField && matcher.kind !== undefined && matcher.kind !== "path") {
      context.addIssue({
        code: "custom",
        message: "Path scope and root require a path target matcher.",
      });
    }
    if (
      matcher.pattern !== undefined &&
      (matcher.kind === "path" || matcher.root !== undefined) &&
      (matcher.pattern.includes("\\") ||
        matcher.pattern.startsWith("/") ||
        /^[A-Za-z]:/.test(matcher.pattern) ||
        matcher.pattern.split("/").includes(".."))
    ) {
      context.addIssue({
        code: "custom",
        path: ["pattern"],
        message: "Path patterns must be root-relative POSIX globs.",
      });
    }
  });
export type TargetMatcher = z.infer<typeof targetMatcherSchema>;

export const permissionRuleFilterSchema = z
  .object({
    toolNames: z
      .array(boundedStringSchema)
      .min(1)
      .max(256)
      .meta({ description: "The tool name is one of these." })
      .optional(),
    toolKinds: z
      .array(toolKindSchema)
      .min(1)
      .max(16)
      .meta({ description: "The tool's kind is one of these." })
      .optional(),
    toolGroups: z
      .array(boundedStringSchema)
      .min(1)
      .max(256)
      .meta({
        description:
          "The tool's group, or the quick_script namespace of an SDK operation, is one of these.",
      })
      .optional(),
    baseRisks: z
      .array(staticToolRiskSchema)
      .min(1)
      .max(16)
      .meta({ description: "The call's risk is one of these." })
      .optional(),
    primaryArgument: valueMatcherSchema
      .meta({
        description:
          "Matcher on the tool's primary argument (for `bash`, the command line).",
      })
      .optional(),
    primaryTarget: targetMatcherSchema
      .meta({ description: "Matcher on the call's first target." })
      .optional(),
    targets: z
      .object({
        quantifier: z.enum(["any", "all"]).meta({
          description:
            "`any`: at least one target matches. `all`: the call has targets and every one matches; use it for `allow` rules so a call touching an allowed and another path is not allowed.",
        }),
        matcher: targetMatcherSchema,
      })
      .strict()
      .meta({ description: "Matcher applied to all targets of the call." })
      .optional(),
    arguments: z
      .array(argumentMatcherSchema)
      .min(1)
      .max(64)
      .meta({ description: "Matchers on named arguments; all must match." })
      .optional(),
  })
  .strict()
  .meta({
    description:
      "Selects calls. Every present field must match; `{}` matches every call.",
  });
export type PermissionRuleFilter = z.infer<typeof permissionRuleFilterSchema>;

export const permissionRuleSchema = z
  .object({
    id: identifierSchema.meta({
      description:
        "Lowercase letters, digits, `.`, `_`, `-`; starts and ends with a letter or digit; at most 128. Unique within the document.",
    }),
    description: z
      .string()
      .trim()
      .min(1)
      .max(1_024)
      .meta({
        description:
          "Shown to the user as the reason when this rule decides; write it for them.",
      })
      .optional(),
    enabled: z.boolean().meta({ description: "Disabled rules are ignored." }),
    priority: z.number().int().min(-1_000).max(1_000).meta({
      description:
        "Higher wins among rules of the same scope and enforcement. Unique per enforcement class within one document.",
    }),
    enforcement: ruleEnforcementSchema,
    when: permissionRuleFilterSchema,
    decision: permissionDecisionSchema,
  })
  .strict()
  .meta({
    description:
      "One permission rule. A `guardrail` rule may only `prompt` or `deny`.",
  })
  .superRefine((rule, context) => {
    if (rule.enforcement === "guardrail" && rule.decision === "allow") {
      context.addIssue({
        code: "custom",
        path: ["decision"],
        message: "Guardrails may only prompt or deny.",
      });
    }
  });
export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export const permissionRuleSetIdSchema = identifierSchema;
export type PermissionRuleSetId = z.infer<typeof permissionRuleSetIdSchema>;

export const ruleSetSourceSchema = z.enum(["builtin", "user"]);
export type RuleSetSource = z.infer<typeof ruleSetSourceSchema>;

function validateRules(
  rules: readonly PermissionRule[],
  context: z.RefinementCtx,
): void {
  const priorities = new Set<string>();
  const ids = new Set<string>();
  for (const [index, rule] of rules.entries()) {
    if (ids.has(rule.id)) {
      context.addIssue({
        code: "custom",
        path: ["rules", index, "id"],
        message: "Rule IDs must be unique within their owning source.",
      });
    }
    ids.add(rule.id);
    const key = `${rule.enforcement}:${rule.priority}`;
    if (priorities.has(key)) {
      context.addIssue({
        code: "custom",
        path: ["rules", index, "priority"],
        message: "Priorities must be unique within each enforcement class.",
      });
    }
    priorities.add(key);
  }
}

export const permissionRuleSetSchema = z
  .object({
    schemaVersion: z.literal(1).meta({ description: "Always 1." }),
    id: identifierSchema.meta({
      description:
        "Rule set id; equals the file name without `.json`. Same format as a rule id. Must not reuse a built-in id: the built-in wins.",
    }),
    name: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .meta({ description: "Name shown in the permission picker." }),
    description: z
      .string()
      .trim()
      .min(1)
      .max(1_024)
      .meta({ description: "What the rule set is for." })
      .optional(),
    source: ruleSetSourceSchema.meta({
      description: "Always `user` for files you write.",
    }),
    enabled: z
      .boolean()
      .meta({ description: "A disabled rule set cannot be selected." }),
    rules: z.array(permissionRuleSchema).min(1).max(256).meta({
      description:
        "All rules must be `overridable`. End with a catch-all rule (`when: {}`) so every call gets a deliberate decision. A rule set used by sub-agents must have no enabled `prompt` rule.",
    }),
  })
  .strict()
  .meta({
    description:
      "A user permission rule set, `<home>/config/rule-sets/<id>.json`. Not expressible here: rule ids are unique, priorities are unique per enforcement class, and rules may not be `guardrail`.",
  })
  .superRefine((ruleSet, context) => {
    validateRules(ruleSet.rules, context);
    for (const [index, rule] of ruleSet.rules.entries()) {
      if (rule.enforcement === "guardrail") {
        context.addIssue({
          code: "custom",
          path: ["rules", index, "enforcement"],
          message: "Rule sets may contain only overridable rules.",
        });
      }
    }
  });
export type PermissionRuleSet = z.infer<typeof permissionRuleSetSchema>;

export const permissionOverlaySchema = z
  .object({
    ruleSetId: permissionRuleSetIdSchema.meta({
      description:
        "Id of the rule set these rules extend. They apply only while that rule set is selected.",
    }),
    rules: z
      .array(permissionRuleSchema)
      .max(256)
      .meta({ description: "Rules added on top of the rule set." }),
  })
  .strict()
  .meta({ description: "Extra rules bound to one rule set." })
  .superRefine((overlay, context) => validateRules(overlay.rules, context));
export type PermissionOverlay = z.infer<typeof permissionOverlaySchema>;

export const permissionOverlayDocumentSchema = z
  .object({
    schemaVersion: z.literal(2).meta({ description: "Always 2." }),
    overlays: z.array(permissionOverlaySchema).max(256).meta({
      description:
        "One entry per rule set id; add rules to the existing entry. At most 256 rules in the whole document.",
    }),
  })
  .strict()
  .meta({
    description:
      "Permission overlays (`permissions.json`). Not expressible here: `ruleSetId` is unique per document, rule ids are unique and priorities are unique per enforcement class within each overlay, and the document holds at most 256 rules in total.",
  })
  .superRefine((document, context) => {
    const ruleSetIds = new Set<string>();
    let ruleCount = 0;
    for (const [index, overlay] of document.overlays.entries()) {
      if (ruleSetIds.has(overlay.ruleSetId)) {
        context.addIssue({
          code: "custom",
          path: ["overlays", index, "ruleSetId"],
          message: "Overlay rule-set IDs must be unique within a document.",
        });
      }
      ruleSetIds.add(overlay.ruleSetId);
      ruleCount += overlay.rules.length;
    }
    if (ruleCount > 256) {
      context.addIssue({
        code: "custom",
        path: ["overlays"],
        message: "Permission overlay documents may contain at most 256 rules.",
      });
    }
  });
export type PermissionOverlayDocument = z.infer<
  typeof permissionOverlayDocumentSchema
>;

export const permissionRuleOriginSchema = z.enum([
  "baseline",
  "rule_set",
  "user",
  "project",
  "conversation",
]);
export type PermissionRuleOrigin = z.infer<typeof permissionRuleOriginSchema>;

export const rulePrecedenceSchema = z
  .object({
    enforcementRank: z.number().int().min(0).max(1),
    scopeRank: z.number().int().min(0).max(4),
    priority: z.number().int().min(-1_000).max(1_000),
  })
  .strict();
export type RulePrecedence = z.infer<typeof rulePrecedenceSchema>;

export const ignoredPermissionSourceSchema = z
  .object({
    origin: z.enum(["user", "project", "conversation"]),
    path: z.string().min(1).max(4_096),
    reason: z.string().min(1).max(4_096),
  })
  .strict();
export type IgnoredPermissionSource = z.infer<
  typeof ignoredPermissionSourceSchema
>;

export const permissionEvaluationResultSchema = z
  .object({
    decision: permissionDecisionSchema,
    reason: z.string().min(1).max(4_096),
    baseRisk: staticToolRiskSchema,
    normalizedTargets: z.array(permissionTargetSchema).max(128),
    winningRuleId: identifierSchema,
    winningRule: permissionRuleSchema,
    winningRuleOrigin: permissionRuleOriginSchema,
    winningRuleSetId: permissionRuleSetIdSchema,
    winningRuleEnforcement: ruleEnforcementSchema,
    winningRulePrecedence: rulePrecedenceSchema,
    activeRuleSetIds: z.array(identifierSchema).min(1).max(16),
    selectedRuleSetId: permissionRuleSetIdSchema,
    ignoredOverlays: z.array(ignoredPermissionSourceSchema).max(16),
    policySnapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    suggestedRules: z.array(permissionRuleSchema).max(16),
  })
  .strict();
export type PermissionEvaluationResult = z.infer<
  typeof permissionEvaluationResultSchema
>;

export const permissionRuleSetSummarySchema = z
  .object({
    id: identifierSchema,
    name: z.string().min(1).max(128),
    description: z.string().max(1_024).optional(),
    source: ruleSetSourceSchema,
    enabled: z.boolean(),
    available: z.boolean(),
    diagnostic: z.string().max(4_096).optional(),
  })
  .strict();
export type PermissionRuleSetSummary = z.infer<
  typeof permissionRuleSetSummarySchema
>;

/** A rule set in the permission configuration, with its own rules (overlays are listed separately). */
export const permissionRuleSetWithRulesSchema =
  permissionRuleSetSummarySchema.extend({
    rules: z.array(permissionRuleSchema).max(256),
  });
export type PermissionRuleSetWithRules = z.infer<
  typeof permissionRuleSetWithRulesSchema
>;

export const permissionOverlayOriginSchema = z.enum([
  "user",
  "project",
  "conversation",
]);
export type PermissionOverlayOrigin = z.infer<
  typeof permissionOverlayOriginSchema
>;

export const projectPermissionTrustSchema = z
  .object({
    status: z.enum(["missing", "invalid", ...trustStateSchema.options]),
    digest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    trustedDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional(),
    trustedAt: z.string().datetime().optional(),
    reason: z.string().max(4_096).optional(),
  })
  .strict();
export type ProjectPermissionTrust = z.infer<
  typeof projectPermissionTrustSchema
>;

export const permissionPolicyConfigurationSchema = z
  .object({
    ruleSets: z.array(permissionRuleSetWithRulesSchema).max(256),
    userOverlays: permissionOverlayDocumentSchema,
    projectOverlays: permissionOverlayDocumentSchema,
    conversationOverlays: permissionOverlayDocumentSchema.optional(),
    projectTrust: projectPermissionTrustSchema,
    diagnostics: z.array(z.string().max(4_096)).max(256),
  })
  .strict();
export type PermissionPolicyConfiguration = z.infer<
  typeof permissionPolicyConfigurationSchema
>;

function validateOverlayOrigin(
  origin: PermissionOverlayOrigin,
  overlay: PermissionOverlay,
  context: z.RefinementCtx,
  pathPrefix: PropertyKey[] = [],
): void {
  if (origin === "user") return;
  for (const [index, rule] of overlay.rules.entries()) {
    if (rule.enforcement === "guardrail") {
      context.addIssue({
        code: "custom",
        path: [...pathPrefix, "rules", index, "enforcement"],
        message: `${origin} overlays may contain only overridable rules.`,
      });
    }
    if (
      origin === "project" &&
      (rule.when.primaryTarget?.root === "nerve_home" ||
        rule.when.primaryTarget?.root === "nerve_data" ||
        rule.when.targets?.matcher.root === "nerve_home" ||
        rule.when.targets?.matcher.root === "nerve_data") &&
      rule.decision === "allow"
    ) {
      context.addIssue({
        code: "custom",
        path: [...pathPrefix, "rules", index, "when"],
        message: "Project overlays cannot grant broad Nerve-owned root access.",
      });
    }
  }
}

export function permissionOverlayForOriginSchema(
  origin: PermissionOverlayOrigin,
) {
  return permissionOverlaySchema.superRefine((overlay, context) =>
    validateOverlayOrigin(origin, overlay, context),
  );
}

export function permissionOverlayDocumentForOriginSchema(
  origin: PermissionOverlayOrigin,
) {
  return permissionOverlayDocumentSchema.superRefine((document, context) => {
    for (const [index, overlay] of document.overlays.entries()) {
      validateOverlayOrigin(origin, overlay, context, ["overlays", index]);
    }
  });
}
