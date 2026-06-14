import { z } from "zod";
import {
  processLogQueryResponseSchema,
  processRecordSchema,
} from "../processes/index.js";

/**
 * Result contracts shared between the `@nerve/tools` executors (producers) and the
 * web UI (consumers). The persisted `toolCallRecordSchema.result` stays `z.unknown()`
 * because results are heterogeneous across tools; these schemas let consumers narrow
 * a result per tool via `safeParse` without throwing on partial/legacy payloads.
 */

export const toolTextContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
export type ToolTextContentPayload = z.infer<typeof toolTextContentSchema>;

export const toolImageContentSchema = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
});
export type ToolImageContentPayload = z.infer<typeof toolImageContentSchema>;

export const toolContentBlockSchema = z.union([
  toolTextContentSchema,
  toolImageContentSchema,
]);
export type ToolContentBlockPayload = z.infer<typeof toolContentBlockSchema>;

/** Loose envelope covering the `details.truncation` shapes emitted by file tools. */
export const truncationDetailsSchema = z
  .object({
    truncated: z.boolean().optional(),
    omittedLines: z.number().optional(),
    nextOffset: z.number().optional(),
    maxLines: z.number().optional(),
  })
  .passthrough();
export type TruncationDetails = z.infer<typeof truncationDetailsSchema>;

export const editResultDetailsSchema = z.object({
  diff: z.string(),
  firstChangedLine: z.number().optional(),
  lineEnding: z.union([z.literal("\n"), z.literal("\r\n")]),
  bom: z.boolean(),
});
export type EditResultDetails = z.infer<typeof editResultDetailsSchema>;

export const bashResultDetailsSchema = z
  .object({
    truncation: truncationDetailsSchema.optional(),
    fullOutputPath: z.string().optional(),
    signal: z.string().nullable().optional(),
  })
  .passthrough();
export type BashResultDetails = z.infer<typeof bashResultDetailsSchema>;

export const fileEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(["file", "directory", "other"]),
});
export type FileEntry = z.infer<typeof fileEntrySchema>;

export const grepMatchSchema = z.object({
  path: z.string(),
  line: z.number(),
  text: z.string(),
});
export type GrepMatch = z.infer<typeof grepMatchSchema>;

export const webSearchResultDetailsSchema = z.object({
  query: z.string(),
  answer: z.string().optional(),
  results: z.array(z.object({ title: z.string(), url: z.string() })),
});
export type WebSearchResultDetails = z.infer<
  typeof webSearchResultDetailsSchema
>;

export const webFetchResultDetailsSchema = z.object({
  url: z.string(),
  status: z.number(),
  contentType: z.string(),
  size: z.number(),
  savedTo: z.string().optional(),
  converted: z.boolean(),
});
export type WebFetchResultDetails = z.infer<typeof webFetchResultDetailsSchema>;

/** File-tool result envelope (read/write/edit/grep/find/ls/bash/web_fetch/web_search). */
export const toolExecutionResultSchema = z.object({
  content: z.string().optional(),
  contentBlocks: z.array(toolContentBlockSchema).optional(),
  details: z.unknown().optional(),
  path: z.string().optional(),
  entries: z.array(fileEntrySchema).optional(),
  matches: z.array(grepMatchSchema).optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().optional(),
});
export type ToolExecutionResultPayload = z.infer<
  typeof toolExecutionResultSchema
>;

/** Result of process_start / process_stop / process_restart. */
export const processActionResultSchema = z.object({
  process: processRecordSchema,
});
export type ProcessActionResult = z.infer<typeof processActionResultSchema>;

/** Result of process_list. */
export const processListResultSchema = z.object({
  processes: z.array(processRecordSchema),
});
export type ProcessListResult = z.infer<typeof processListResultSchema>;

/** Result of process_logs (re-export of the existing query response shape). */
export const processLogsResultSchema = processLogQueryResponseSchema;
export type ProcessLogsResult = z.infer<typeof processLogsResultSchema>;

/** Result of explore. */
export const exploreUsageStatsSchema = z.object({
  input: z.number().nonnegative().default(0),
  output: z.number().nonnegative().default(0),
  cacheRead: z.number().nonnegative().default(0),
  cacheWrite: z.number().nonnegative().default(0),
  totalTokens: z.number().nonnegative().default(0),
  cost: z.number().nonnegative().default(0),
  turns: z.number().int().nonnegative().default(0),
});
export type ExploreUsageStatsPayload = z.infer<typeof exploreUsageStatsSchema>;

export const exploreStepSchema = z.object({
  type: z.enum(["tool_call", "tool_result", "assistant"]),
  toolName: z.string().optional(),
  message: z.string(),
  timestamp: z.string().datetime().optional(),
});
export type ExploreStepPayload = z.infer<typeof exploreStepSchema>;

export const exploreReportSchema = z.object({
  agentId: z.string().startsWith("agent_"),
  task: z.string(),
  label: z.string().optional(),
  status: z.enum(["completed", "failed", "aborted"]).default("completed"),
  report: z.string(),
  reportPath: z.string().min(1).optional(),
  summaryPreview: z.string().optional(),
  usage: exploreUsageStatsSchema.optional(),
  model: z.string().optional(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  steps: z.array(exploreStepSchema).optional(),
});
export type ExploreReportPayload = z.infer<typeof exploreReportSchema>;

export const exploreResultSchema = z.object({
  reports: z.array(exploreReportSchema),
  contentBlocks: z.array(toolContentBlockSchema).optional(),
});
export type ExploreResultPayload = z.infer<typeof exploreResultSchema>;

/** Result of ask_user (resolved question). */
export const askUserResultSchema = z.object({
  question: z.string(),
  context: z.string().optional(),
  recommendation: z.string().optional(),
  response: z.string().optional(),
  dismissed: z.boolean().optional(),
  dismissedReason: z.string().optional(),
});
export type AskUserResult = z.infer<typeof askUserResultSchema>;

/** Todo item shape shared by todos_set / todos_get. */
export const todoItemSchema = z.object({
  todo: z.string(),
  done: z.boolean(),
});
export type TodoItem = z.infer<typeof todoItemSchema>;

/** Result of todos_set / todos_get. */
export const todosResultSchema = z.object({
  contentBlocks: z.array(toolContentBlockSchema).optional(),
  details: z
    .object({
      todos: z.array(todoItemSchema),
    })
    .optional(),
});
export type TodosResult = z.infer<typeof todosResultSchema>;
