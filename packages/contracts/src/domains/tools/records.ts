import { z } from "zod";
import { toolNameSchema } from "./tool-name.js";
export * from "./tool-name.js";
import {
  durablePermissionSchema,
  permissionRuleKindSchema,
  toolRiskSchema,
} from "../permissions/permissions.js";
import {
  toolKindSchema,
  staticToolRiskSchema,
  permissionTargetKindSchema,
} from "../permissions/permission-rule-sets.js";
export const toolGroupNameSchema = z.enum([
  "subagents",
  "fileInspection",
  "fileEditing",
  "shell",
  "python",
  "web",
  "vision",
  "imageGeneration",
  "diagramExport",
  "jira",
  "confluence",
  "input",
  "todos",
  "taskManagement",
  "explore",
  "planMode",
]);
export type ToolGroupName = z.infer<typeof toolGroupNameSchema>;

export const toolExecutionKindSchema = z.enum(["local", "host"]);
export type ToolExecutionKind = z.infer<typeof toolExecutionKindSchema>;

export const toolTraitSchema = z.enum([
  "write_capable",
  "read_only_network",
  "long_running",
  "credentialed",
  "suspending",
]);
export type ToolTrait = z.infer<typeof toolTraitSchema>;

export const toolDescriptorSchema = z.object({
  name: toolNameSchema,
  kind: toolKindSchema,
  groups: z.array(z.string().trim().min(1).max(128)).min(1),
  baseRisk: staticToolRiskSchema,
  primaryArguments: z.array(z.string().trim().min(1).max(128)),
  targetKinds: z.array(permissionTargetKindSchema).min(1),
  /** @deprecated Use baseRisk. */
  risk: toolRiskSchema,
  argumentSensitive: z.boolean().default(false),
  description: z.string(),
  group: toolGroupNameSchema,
  executionKind: toolExecutionKindSchema,
  traits: z.array(toolTraitSchema),
  permission: z.object({
    ruleKind: permissionRuleKindSchema,
    durableAllow: durablePermissionSchema,
  }),
});
export type ToolDescriptor = z.infer<typeof toolDescriptorSchema>;

export const toolCallStatusSchema = z.enum([
  "committed",
  "waiting",
  "running",
  "completed",
  "denied",
  "failed",
  "cancelled",
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

export const toolPhaseSchema = z.enum([
  "drafting",
  "drafted",
  "executing",
  "completed",
  "failed",
  "denied",
  "cancelled",
  "interrupted",
]);
export type ToolPhase = z.infer<typeof toolPhaseSchema>;

export type ToolCallErrorDetails = Record<string, unknown>;
