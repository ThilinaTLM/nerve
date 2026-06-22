import { z } from "zod";
import {
  taskLogQueryResponseSchema,
  taskRecordSchema,
  taskStatusSchema,
} from "../tasks/index.js";

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
    omittedBytes: z.number().optional(),
    truncatedLines: z.number().optional(),
    direction: z.enum(["head", "tail", "line", "head_tail"]).optional(),
    partialLine: z.boolean().optional(),
    nextOffset: z.number().optional(),
    nextByteOffset: z.number().optional(),
    maxLines: z.number().optional(),
    maxBytes: z.number().optional(),
    maxLineChars: z.number().optional(),
    byteOffset: z.number().optional(),
    byteLimit: z.number().optional(),
    rawResultPath: z.string().optional(),
  })
  .passthrough();
export type TruncationDetails = z.infer<typeof truncationDetailsSchema>;

export const processStreamResultDetailsSchema = z
  .object({
    bytes: z.number().optional(),
    lines: z.number().optional(),
    displayedBytes: z.number().optional(),
    displayedLines: z.number().optional(),
    truncated: z.boolean().optional(),
    omittedLines: z.number().optional(),
    omittedBytes: z.number().optional(),
    truncatedLines: z.number().optional(),
    direction: z.enum(["head", "tail", "line", "head_tail"]).optional(),
    maxLineChars: z.number().optional(),
    savedTo: z.string().optional(),
  })
  .passthrough();
export type ProcessStreamResultDetails = z.infer<
  typeof processStreamResultDetailsSchema
>;

export const processStreamsResultDetailsSchema = z
  .object({
    stdout: processStreamResultDetailsSchema.optional(),
    stderr: processStreamResultDetailsSchema.optional(),
    combined: processStreamResultDetailsSchema.optional(),
  })
  .passthrough();
export type ProcessStreamsResultDetails = z.infer<
  typeof processStreamsResultDetailsSchema
>;

export const editResultDetailsSchema = z
  .object({
    diff: z.string(),
    firstChangedLine: z.number().optional(),
    lineEnding: z.union([z.literal("\n"), z.literal("\r\n")]),
    bom: z.boolean(),
  })
  .passthrough();
export type EditResultDetails = z.infer<typeof editResultDetailsSchema>;

export const smartEditOperationResultSchema = z
  .object({
    index: z.number().int().nonnegative(),
    type: z.enum([
      "replace_text",
      "insert_text",
      "replace_lines",
      "insert_lines",
      "apply_patch",
    ]),
    matchMode: z.enum(["exact", "trimmed", "whitespace"]).optional(),
    occurrence: z.number().int().positive().optional(),
    matchCount: z.number().int().nonnegative().optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    matchedBy: z.enum([
      "unique",
      "occurrence",
      "line_range",
      "line_insert",
      "patch",
    ]),
  })
  .passthrough();
export type SmartEditOperationResult = z.infer<
  typeof smartEditOperationResultSchema
>;

export const smartEditResultDetailsSchema = editResultDetailsSchema.extend({
  dryRun: z.boolean(),
  operationCount: z.number().int().nonnegative(),
  operations: z.array(smartEditOperationResultSchema),
});
export type SmartEditResultDetails = z.infer<
  typeof smartEditResultDetailsSchema
>;

export const bashResultDetailsSchema = z
  .object({
    truncation: truncationDetailsSchema.optional(),
    fullOutputPath: z.string().optional(),
    rawResultPath: z.string().optional(),
    signal: z.string().nullable().optional(),
  })
  .passthrough();
export type BashResultDetails = z.infer<typeof bashResultDetailsSchema>;

export const pythonArtifactResultDetailsSchema = z
  .object({
    path: z.string(),
    size: z.number().nonnegative().optional(),
  })
  .passthrough();
export type PythonArtifactResultDetails = z.infer<
  typeof pythonArtifactResultDetailsSchema
>;

export const pythonResultDetailsSchema = z
  .object({
    truncation: truncationDetailsSchema.optional(),
    fullOutputPath: z.string().optional(),
    rawResultPath: z.string().optional(),
    signal: z.string().nullable().optional(),
    executable: z.string().optional(),
    version: z.string().optional(),
    timeoutSeconds: z.number().optional(),
    durationMs: z.number().optional(),
    timedOut: z.boolean().optional(),
    timeoutKilled: z.boolean().optional(),
    allowNetwork: z.boolean().optional(),
    allowFileWrite: z.boolean().optional(),
    inputMode: z.enum(["inline", "file"]).optional(),
    scriptPath: z.string().optional(),
    streams: processStreamsResultDetailsSchema.optional(),
    artifactDir: z.string().optional(),
    artifacts: z.array(pythonArtifactResultDetailsSchema).optional(),
    envKeys: z.array(z.string()).optional(),
  })
  .passthrough();
export type PythonResultDetails = z.infer<typeof pythonResultDetailsSchema>;

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

/** File-tool result envelope (read/write/edit/grep/find/ls/bash/python/web_fetch/web_search). */
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

export const taskCancelOutcomeSchema = z.enum([
  "cancelled",
  "force_cancelled",
  "already_terminal",
  "became_terminal_before_cancel",
  "no_matching_active_task",
]);
export type TaskCancelOutcomePayload = z.infer<typeof taskCancelOutcomeSchema>;

export const taskCancelResultSchema = z.object({
  taskId: z.string().startsWith("task_").optional(),
  taskName: z.string().optional(),
  requestedSignal: z.enum(["SIGTERM", "SIGINT", "SIGKILL"]).optional(),
  outcome: taskCancelOutcomeSchema,
  status: taskStatusSchema.optional(),
  message: z.string(),
});
export type TaskCancelResultPayload = z.infer<typeof taskCancelResultSchema>;

/** Result of task_start / task_cancel / task_restart. */
export const taskActionResultSchema = z.object({
  task: taskRecordSchema.optional(),
  tasks: z.array(taskRecordSchema).optional(),
  groupId: z.string().startsWith("taskgrp_").optional(),
  groupName: z.string().optional(),
  restartedFromTaskId: z.string().startsWith("task_").optional(),
  newTaskId: z.string().startsWith("task_").optional(),
  restartRootTaskId: z.string().startsWith("task_").optional(),
  cancelResults: z.array(taskCancelResultSchema).optional(),
  contentBlocks: z.array(toolContentBlockSchema).optional(),
});
export type TaskActionResult = z.infer<typeof taskActionResultSchema>;

/** Result of task_list. */
export const taskListResultSchema = z.object({
  tasks: z.array(taskRecordSchema),
  groupId: z.string().startsWith("taskgrp_").optional(),
  contentBlocks: z.array(toolContentBlockSchema).optional(),
});
export type TaskListResult = z.infer<typeof taskListResultSchema>;

/** Result of task_logs (re-export of the existing query response shape). */
export const taskLogsResultSchema = taskLogQueryResponseSchema.extend({
  contentBlocks: z.array(toolContentBlockSchema).optional(),
});
export type TaskLogsResult = z.infer<typeof taskLogsResultSchema>;

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
