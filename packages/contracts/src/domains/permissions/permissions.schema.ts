import { z } from "zod";

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

export const permissionPathAccessSchema = z.enum([
  "read",
  "write",
  "read_write",
]);
export type PermissionPathAccess = z.infer<typeof permissionPathAccessSchema>;

const toolSelectorSchema = z.object({
  kind: z.literal("tool"),
  toolName: z.string().min(1).max(128),
});
const commandPrefixSelectorSchema = z.object({
  kind: z.literal("command_prefix"),
  tokens: z.array(z.string().trim().min(1).max(256)).min(1).max(16),
});
const pathGlobSelectorSchema = z.object({
  kind: z.literal("path_glob"),
  access: permissionPathAccessSchema,
  pattern: z.string().trim().min(1).max(512),
});
const webHostSelectorSchema = z.object({
  kind: z.literal("web_host"),
  pattern: z.string().trim().min(1).max(253),
});

export const permissionSelectorSchema = z.discriminatedUnion("kind", [
  toolSelectorSchema,
  commandPrefixSelectorSchema,
  pathGlobSelectorSchema,
  webHostSelectorSchema,
]);
export type PermissionSelector = z.infer<typeof permissionSelectorSchema>;

const permissionExceptionBaseSchema = z.object({
  id: z.string().startsWith("exception_").max(128),
  selector: permissionSelectorSchema,
});

export const permissionExceptionSchema = z
  .discriminatedUnion("effect", [
    permissionExceptionBaseSchema.extend({
      effect: z.literal("allow"),
      risk: toolRiskSchema,
    }),
    permissionExceptionBaseSchema.extend({
      effect: z.literal("deny"),
    }),
  ])
  .superRefine((exception, context) => {
    const selector = exception.selector;
    if (selector.kind === "path_glob") {
      const pattern = selector.pattern;
      if (
        pattern.includes("\\") ||
        pattern.startsWith("/") ||
        /^[A-Za-z]:/.test(pattern) ||
        pattern.split("/").includes("..")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Path globs must be project-relative and use forward slashes.",
          path: ["selector", "pattern"],
        });
      }
    }
    if (selector.kind === "web_host") {
      const host = selector.pattern.startsWith("*.")
        ? selector.pattern.slice(2)
        : selector.pattern;
      if (
        !/^[a-z0-9.-]+$/i.test(host) ||
        host.startsWith(".") ||
        host.endsWith(".") ||
        host.includes("..")
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Host patterns must be exact hosts or use one leading wildcard.",
          path: ["selector", "pattern"],
        });
      }
    }
    if (exception.effect !== "allow") return;
    if (["destructive", "secret", "deployment"].includes(exception.risk)) {
      context.addIssue({
        code: "custom",
        message: `Risk '${exception.risk}' cannot be durably allowed.`,
        path: ["risk"],
      });
    }
    if (selector.kind === "tool" && selector.toolName === "python_exec") {
      context.addIssue({
        code: "custom",
        message: "Python execution cannot be durably allowed.",
        path: ["selector", "toolName"],
      });
    }
    if (selector.kind === "command_prefix" && exception.risk !== "command") {
      context.addIssue({
        code: "custom",
        message: "Command prefixes require command risk.",
        path: ["risk"],
      });
    }
    if (selector.kind === "path_glob" && exception.risk !== "workspace_write") {
      context.addIssue({
        code: "custom",
        message: "Path allows require workspace-write risk.",
        path: ["risk"],
      });
    }
    if (selector.kind === "web_host" && exception.risk !== "network") {
      context.addIssue({
        code: "custom",
        message: "Website allows require network risk.",
        path: ["risk"],
      });
    }
  });
export type PermissionException = z.infer<typeof permissionExceptionSchema>;
