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

export const permissionDecisionSchema = z.enum(["allow", "prompt", "deny"]);
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export const ruleDecisionSchema = permissionDecisionSchema;
export type RuleDecision = PermissionDecision;

export const ruleEnforcementSchema = z.enum(["overridable", "guardrail"]);
export type RuleEnforcement = z.infer<typeof ruleEnforcementSchema>;

export const toolKindSchema = z.enum([
  "filesystem",
  "command",
  "code",
  "network",
  "interaction",
  "orchestration",
  "deployment",
  "integration",
  "other",
]);
export type ToolKind = z.infer<typeof toolKindSchema>;

export const staticToolRiskSchema = z.enum([
  "read",
  "write",
  "network",
  "secret",
  "destructive",
  "deployment",
  "agent_spawn",
  "interaction",
  "unknown",
]);
export type StaticToolRisk = z.infer<typeof staticToolRiskSchema>;

export const permissionTargetKindSchema = z.enum([
  "path",
  "url",
  "agent",
  "whole_tool",
]);
export type PermissionTargetKind = z.infer<typeof permissionTargetKindSchema>;

export const pathRootSchema = z.enum([
  "project",
  "nerve_home",
  "nerve_data",
  "plans",
]);
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
  z.object({ kind: z.literal("whole_tool") }).strict(),
]);
export type PermissionTarget = z.infer<typeof permissionTargetSchema>;

export const comparableValueSchema = z.union([
  primitiveValueSchema,
  z.array(primitiveValueSchema).max(256),
]);
export type PrimitiveValue = z.infer<typeof primitiveValueSchema>;
export type ComparableValue = z.infer<typeof comparableValueSchema>;

export const valueMatcherSchema = z.discriminatedUnion("operator", [
  z
    .object({
      operator: z.enum(["equals", "not_equals"]),
      value: comparableValueSchema,
    })
    .strict(),
  z
    .object({
      operator: z.literal("in"),
      value: z.array(primitiveValueSchema).min(1).max(256),
    })
    .strict(),
  z
    .object({
      operator: z.literal("glob"),
      value: z.string().max(8_192),
    })
    .strict(),
  z.object({ operator: z.literal("exists"), value: z.boolean() }).strict(),
]);
export type ValueMatcher = z.infer<typeof valueMatcherSchema>;

const argumentPathSchema = z
  .string()
  .min(6)
  .max(512)
  .regex(/^args\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/);
export const argumentMatcherSchema = z.discriminatedUnion("operator", [
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
      value: z.array(primitiveValueSchema).min(1).max(256),
    })
    .strict(),
  z
    .object({
      path: argumentPathSchema,
      operator: z.literal("glob"),
      value: z.string().max(8_192),
    })
    .strict(),
  z
    .object({
      path: argumentPathSchema,
      operator: z.literal("exists"),
      value: z.boolean(),
    })
    .strict(),
]);
export type ArgumentMatcher = z.infer<typeof argumentMatcherSchema>;

const targetPatternSchema = z
  .string()
  .max(8_192)
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
    access: z.enum(["read", "write"]).optional(),
    scope: z.enum(["exact", "tree"]).optional(),
    root: pathRootSchema.optional(),
    pattern: targetPatternSchema.optional(),
  })
  .strict()
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
    toolNames: z.array(boundedStringSchema).min(1).max(256).optional(),
    toolKinds: z.array(toolKindSchema).min(1).max(16).optional(),
    toolGroups: z.array(boundedStringSchema).min(1).max(256).optional(),
    baseRisks: z.array(staticToolRiskSchema).min(1).max(16).optional(),
    primaryArgument: valueMatcherSchema.optional(),
    primaryTarget: targetMatcherSchema.optional(),
    targets: z
      .object({
        quantifier: z.enum(["any", "all"]),
        matcher: targetMatcherSchema,
      })
      .strict()
      .optional(),
    arguments: z.array(argumentMatcherSchema).min(1).max(64).optional(),
  })
  .strict();
export type PermissionRuleFilter = z.infer<typeof permissionRuleFilterSchema>;

export const permissionRuleSchema = z
  .object({
    id: identifierSchema,
    description: z.string().trim().min(1).max(1_024).optional(),
    enabled: z.boolean(),
    priority: z.number().int().min(-1_000).max(1_000),
    enforcement: ruleEnforcementSchema,
    when: permissionRuleFilterSchema,
    decision: ruleDecisionSchema,
  })
  .strict()
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
export const agentModeIdSchema = identifierSchema;
export type AgentModeId = z.infer<typeof agentModeIdSchema>;

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
    schemaVersion: z.literal(1),
    id: identifierSchema,
    name: z.string().trim().min(1).max(128),
    description: z.string().trim().min(1).max(1_024).optional(),
    source: ruleSetSourceSchema,
    enabled: z.boolean(),
    compatibleModes: z.array(agentModeIdSchema).max(64).optional(),
    rules: z.array(permissionRuleSchema).min(1).max(256),
  })
  .strict()
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
    schemaVersion: z.literal(1),
    rules: z.array(permissionRuleSchema).max(256),
  })
  .strict()
  .superRefine((overlay, context) => validateRules(overlay.rules, context));
export type PermissionOverlay = z.infer<typeof permissionOverlaySchema>;

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
    winningRuleEnforcement: ruleEnforcementSchema,
    winningRulePrecedence: rulePrecedenceSchema,
    activeRuleSetIds: z.array(identifierSchema).min(1).max(16),
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
    compatibleModes: z.array(agentModeIdSchema).max(64).optional(),
    available: z.boolean(),
    diagnostic: z.string().max(4_096).optional(),
  })
  .strict();
export type PermissionRuleSetSummary = z.infer<
  typeof permissionRuleSetSummarySchema
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
    status: z.enum(["missing", "invalid", "untrusted", "trusted"]),
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
    ruleSets: z.array(permissionRuleSetSummarySchema).max(256),
    userOverlay: permissionOverlaySchema,
    projectOverlay: permissionOverlaySchema,
    conversationOverlay: permissionOverlaySchema.optional(),
    projectTrust: projectPermissionTrustSchema,
    diagnostics: z.array(z.string().max(4_096)).max(256),
  })
  .strict();
export type PermissionPolicyConfiguration = z.infer<
  typeof permissionPolicyConfigurationSchema
>;

export function permissionOverlayForOriginSchema(
  origin: PermissionOverlayOrigin,
) {
  return permissionOverlaySchema.superRefine((overlay, context) => {
    if (origin === "user") return;
    for (const [index, rule] of overlay.rules.entries()) {
      if (rule.enforcement === "guardrail") {
        context.addIssue({
          code: "custom",
          path: ["rules", index, "enforcement"],
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
          path: ["rules", index, "when"],
          message:
            "Project overlays cannot grant broad Nerve-owned root access.",
        });
      }
    }
  });
}
