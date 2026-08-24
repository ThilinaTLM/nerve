import { z } from "zod";
import { toolNameSchema } from "../tools/tool-name.schema.js";

export const permissionLevelSchema = z.enum([
  "autonomous",
  "supervised",
  "read_only",
]);
export type PermissionLevel = z.infer<typeof permissionLevelSchema>;

export const toolRiskSchema = z.enum([
  "read",
  "workspace_write",
  "command",
  "network",
  "secret",
  "destructive",
  "agent_spawn",
  "deployment",
  "interaction",
]);
export type ToolRisk = z.infer<typeof toolRiskSchema>;

export const permissionExceptionEffectSchema = z.enum(["allow", "deny"]);
export type PermissionExceptionEffect = z.infer<
  typeof permissionExceptionEffectSchema
>;

export const permissionRuleKindSchema = z.enum([
  "path_glob",
  "command_glob",
  "url_glob",
  "tool",
]);
export type PermissionRuleKind = z.infer<typeof permissionRuleKindSchema>;

export const durablePermissionSchema = z.enum(["never", "tool", "target"]);
export type DurablePermission = z.infer<typeof durablePermissionSchema>;

const pathRuleTools = new Set(["read", "edit", "write", "grep", "find", "ls"]);

export const permissionExceptionSchema = z
  .object({
    id: z.string().startsWith("exception_").max(128),
    tool: toolNameSchema,
    effect: permissionExceptionEffectSchema,
    rule: z.string().trim().min(1).max(1_024),
  })
  .superRefine((exception, context) => {
    const rule = exception.rule;
    if (/\r|\n|\0/.test(rule)) {
      context.addIssue({
        code: "custom",
        message: "Permission rules must be a single line.",
        path: ["rule"],
      });
    }
    if (pathRuleTools.has(exception.tool)) {
      if (
        rule.includes("\\") ||
        rule.startsWith("/") ||
        /^[A-Za-z]:/.test(rule) ||
        rule.split("/").includes("..")
      ) {
        context.addIssue({
          code: "custom",
          message: "Path rules must be project-relative POSIX globs.",
          path: ["rule"],
        });
      }
      return;
    }
    if (exception.tool === "bash") {
      if (rule === "*") {
        context.addIssue({
          code: "custom",
          message: "Bash rules must use a focused command glob.",
          path: ["rule"],
        });
      }
      return;
    }
    if (exception.tool === "web_fetch") {
      if (!rule.includes("://")) {
        context.addIssue({
          code: "custom",
          message: "Web Fetch rules must include a URL scheme glob.",
          path: ["rule"],
        });
      }
      return;
    }
    if (rule !== "*") {
      context.addIssue({
        code: "custom",
        message: "Whole-tool permission rules must be '*'.",
        path: ["rule"],
      });
    }
  });
export type PermissionException = z.infer<typeof permissionExceptionSchema>;

/** Canonical scoped permission rule persisted independently of settings. */
export const permissionRuleScopeSchema = z.enum(["user", "project"]);
export type PermissionRuleScope = z.infer<typeof permissionRuleScopeSchema>;

export const permissionRuleEffectSchema = permissionExceptionEffectSchema;
export type PermissionRuleEffect = z.infer<typeof permissionRuleEffectSchema>;

export const permissionRuleMatcherKindSchema = z.enum([
  "whole_tool",
  "path_glob",
  "command_glob",
  "url_glob",
]);
export type PermissionRuleMatcherKind = z.infer<
  typeof permissionRuleMatcherKindSchema
>;

export const permissionRuleSchema = z
  .object({
    id: z.string().startsWith("rule_").max(128),
    scope: permissionRuleScopeSchema,
    projectId: z.string().startsWith("proj_").optional(),
    effect: permissionRuleEffectSchema,
    /** Open so historical rules remain readable after catalog changes. */
    toolName: z.string().trim().min(1).max(128),
    matcherKind: permissionRuleMatcherKindSchema,
    pattern: z.string().trim().min(1).max(1_024),
    enabled: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((rule, context) => {
    if ((rule.scope === "project") !== Boolean(rule.projectId)) {
      context.addIssue({
        code: "custom",
        message:
          "Project rules require projectId; user rules must not have one.",
        path: ["projectId"],
      });
    }
    if (/\r|\n|\0/.test(rule.pattern)) {
      context.addIssue({
        code: "custom",
        message: "Permission rule patterns must be a single line.",
        path: ["pattern"],
      });
    }
    if (rule.matcherKind === "whole_tool" && rule.pattern !== "*") {
      context.addIssue({
        code: "custom",
        message: "Whole-tool rules must use '*'.",
        path: ["pattern"],
      });
    }
    if (
      rule.matcherKind === "path_glob" &&
      (rule.pattern.includes("\\") ||
        rule.pattern.startsWith("/") ||
        /^[A-Za-z]:/.test(rule.pattern) ||
        rule.pattern.split("/").includes(".."))
    ) {
      context.addIssue({
        code: "custom",
        message: "Path rules must be project-relative POSIX globs.",
        path: ["pattern"],
      });
    }
  });
export type PermissionRule = z.infer<typeof permissionRuleSchema>;

export const supervisionDecisionKindSchema = z.enum([
  "allow",
  "prompt",
  "deny",
]);
export type SupervisionDecisionKind = z.infer<
  typeof supervisionDecisionKindSchema
>;

export const normalizedPermissionTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("path"),
    access: z.enum(["read", "write"]),
    scope: z.enum(["exact", "tree"]),
    absolutePath: z.string().min(1),
    projectRelativePath: z.string().optional(),
  }),
  z.object({
    kind: z.literal("command_segment"),
    normalizedTokens: z.array(z.string()),
    risk: z.enum(["read", "command"]),
  }),
  z.object({ kind: z.literal("url"), url: z.string().url() }),
  z.object({ kind: z.literal("whole_tool") }),
]);
export type NormalizedPermissionTarget = z.infer<
  typeof normalizedPermissionTargetSchema
>;

export const supervisionDecisionSchema = z.object({
  version: z.literal(1),
  decision: supervisionDecisionKindSchema,
  effectiveRisk: toolRiskSchema,
  reason: z.string().min(1).max(4_096),
  normalizedArgs: z.record(z.string(), z.unknown()),
  normalizedTargets: z.array(normalizedPermissionTargetSchema).max(64),
  matchedRuleIds: z.array(z.string().startsWith("rule_")).max(256),
  policySnapshotHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  suggestedRules: z.array(permissionRuleSchema).max(16),
});
export type SupervisionDecision = z.infer<typeof supervisionDecisionSchema>;
