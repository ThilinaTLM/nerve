import { z } from "zod";
import { modeSchema, permissionLevelSchema } from "./settings.js";

export const sessionRecordSchema = z.object({
  id: z.string().startsWith("ses_"),
  projectId: z.string().startsWith("proj_"),
  title: z.string().min(1),
  mode: modeSchema,
  permissionLevel: permissionLevelSchema,
  activeAgentId: z.string().startsWith("agent_").optional(),
  activeEntryId: z.string().startsWith("entry_").optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export const createSessionRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  title: z.string().min(1).optional(),
  mode: modeSchema.optional(),
  permissionLevel: permissionLevelSchema.optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const importSessionRequestSchema = z.object({
  project: z
    .object({
      name: z.string().min(1).optional(),
      dir: z.string().min(1),
    })
    .optional(),
  session: z.object({
    title: z.string().min(1).optional(),
    mode: modeSchema.optional(),
    permissionLevel: permissionLevelSchema.optional(),
  }),
  agents: z.array(z.unknown()).default([]),
  entries: z.array(z.unknown()).default([]),
});
export type ImportSessionRequest = z.infer<typeof importSessionRequestSchema>;

export const sessionEntryUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cost: z.number().nonnegative(),
});
export type SessionEntryUsage = z.infer<typeof sessionEntryUsageSchema>;

export const sessionEntryKindSchema = z.enum([
  "message",
  "compaction",
  "branch_summary",
  "subagent_summary",
]);
export type SessionEntryKind = z.infer<typeof sessionEntryKindSchema>;

export const sessionEntrySchema = z.object({
  id: z.string().startsWith("entry_"),
  sessionId: z.string().startsWith("ses_"),
  agentId: z.string().startsWith("agent_").optional(),
  runId: z.string().startsWith("run_").optional(),
  turnId: z.string().startsWith("turn_").optional(),
  liveMessageId: z.string().startsWith("msg_").optional(),
  parentEntryId: z.string().startsWith("entry_").optional(),
  role: z.enum(["user", "assistant", "system"]),
  kind: sessionEntryKindSchema.default("message"),
  text: z.string(),
  summary: z.string().optional(),
  tokensBefore: z.number().int().nonnegative().optional(),
  usage: sessionEntryUsageSchema.optional(),
  firstKeptEntryId: z.string().startsWith("entry_").optional(),
  fromEntryId: z.string().startsWith("entry_").optional(),
  details: z.unknown().optional(),
  createdAt: z.string().datetime(),
});
export type SessionEntry = z.infer<typeof sessionEntrySchema>;

export const sessionTreeNodeSchema = z.object({
  entry: sessionEntrySchema,
  childEntryIds: z.array(z.string().startsWith("entry_")),
});
export type SessionTreeNode = z.infer<typeof sessionTreeNodeSchema>;

export const sessionTreeSchema = z.object({
  sessionId: z.string().startsWith("ses_"),
  activeEntryId: z.string().startsWith("entry_").optional(),
  rootEntryIds: z.array(z.string().startsWith("entry_")),
  nodes: z.array(sessionTreeNodeSchema),
});
export type SessionTree = z.infer<typeof sessionTreeSchema>;

export const navigateSessionRequestSchema = z.object({
  activeEntryId: z.string().startsWith("entry_").nullable(),
  summarize: z.boolean().optional(),
  summaryInstructions: z.string().optional(),
});
export type NavigateSessionRequest = z.infer<
  typeof navigateSessionRequestSchema
>;

export const compactSessionRequestSchema = z.object({
  instructions: z.string().optional(),
  keepRecentTokens: z.number().int().positive().optional(),
});
export type CompactSessionRequest = z.infer<typeof compactSessionRequestSchema>;
