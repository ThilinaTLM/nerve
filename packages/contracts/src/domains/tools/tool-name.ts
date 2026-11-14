import { z } from "zod";

export const coreToolNameSchema = z.enum([
  "read",
  "bash",
  "python_exec",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "ask_user",
  "todos_set",
  "todos_get",
  "web_search",
  "web_fetch",
  "explain_image",
  "quick_script",
]);
export type CoreToolName = z.infer<typeof coreToolNameSchema>;

export const userConfigurableToolNameSchema = z.enum([
  "plan_present",
  "subagent_prompt",
  "subagent_status",
  "subagent_stop",
  "web_search",
  "web_fetch",
  "explain_image",
  "python_exec",
]);
export type UserConfigurableToolName = z.infer<
  typeof userConfigurableToolNameSchema
>;

export const orchestrationToolNameSchema = z.enum([
  "subagent_prompt",
  "subagent_status",
  "subagent_stop",
  "async_bash",
  "launch",
  "plan_present",
]);
export type OrchestrationToolName = z.infer<typeof orchestrationToolNameSchema>;

export const toolNameSchema = z.enum([
  ...coreToolNameSchema.options,
  ...orchestrationToolNameSchema.options,
]);
export type ToolName = z.infer<typeof toolNameSchema>;

// Tool-call records outlive the manifest that produced them. Keep persisted and
// transcript records readable after tools are renamed or removed while the
// active descriptor/dispatch schemas remain restricted to ToolName.
export const recordedToolNameSchema = z.string().min(1).max(128);
export type RecordedToolName = z.infer<typeof recordedToolNameSchema>;
