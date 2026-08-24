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
