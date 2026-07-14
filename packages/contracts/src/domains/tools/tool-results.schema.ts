import { z } from "zod";
import { thinkingLevelSchema } from "../models/index.js";
import {
  taskListeningPortSchema,
  taskLogQueryResponseSchema,
  taskRecordSchema,
  taskStatusSchema,
} from "../tasks/index.js";

/**
 * Result contracts shared between the `@nervekit/tools` executors (producers) and the
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

export const textLimitDirectionSchema = z.enum([
  "head",
  "tail",
  "line",
  "head_tail",
]);
export type TextLimitDirection = z.infer<typeof textLimitDirectionSchema>;

export const textLimitSnapshotSchema = z
  .object({
    truncated: z.boolean(),
    direction: textLimitDirectionSchema.optional(),
    originalBytes: z.number().nonnegative().optional(),
    displayedBytes: z.number().nonnegative().optional(),
    omittedBytes: z.number().nonnegative().optional(),
    originalChars: z.number().nonnegative().optional(),
    displayedChars: z.number().nonnegative().optional(),
    omittedChars: z.number().nonnegative().optional(),
    originalLines: z.number().nonnegative().optional(),
    displayedLines: z.number().nonnegative().optional(),
    omittedLines: z.number().nonnegative().optional(),
    truncatedLines: z.number().nonnegative().optional(),
    maxBytes: z.number().positive().optional(),
    maxLines: z.number().positive().optional(),
    maxLineChars: z.number().positive().optional(),
    partialLine: z.boolean().optional(),
  })
  .passthrough();
export type TextLimitSnapshotPayload = z.infer<typeof textLimitSnapshotSchema>;

export const toolOutputArtifactSchema = z
  .object({
    kind: z.enum([
      "full_output",
      "raw_result",
      "fetched_content",
      "transcript",
    ]),
    path: z.string().min(1),
    label: z.string().optional(),
    bytes: z.number().nonnegative().optional(),
    chars: z.number().nonnegative().optional(),
    lines: z.number().nonnegative().optional(),
  })
  .passthrough();
export type ToolOutputArtifactPayload = z.infer<
  typeof toolOutputArtifactSchema
>;

export const liveOutputLimitSchema = z
  .object({
    capped: z.boolean(),
    direction: z.literal("tail"),
    maxChars: z.number().positive(),
    maxChunks: z.number().positive(),
    totalChars: z.number().nonnegative().optional(),
    displayedChars: z.number().nonnegative().optional(),
    omittedChars: z.number().nonnegative().optional(),
    totalLines: z.number().nonnegative().optional(),
    displayedLines: z.number().nonnegative().optional(),
    omittedLines: z.number().nonnegative().optional(),
  })
  .passthrough();
export type LiveOutputLimitPayload = z.infer<typeof liveOutputLimitSchema>;

export const toolOutputLimitsSchema = z
  .object({
    execution: textLimitSnapshotSchema.optional(),
    storage: textLimitSnapshotSchema
      .extend({ rawResultPath: z.string().optional() })
      .optional(),
    model: textLimitSnapshotSchema
      .extend({
        contentKind: z.enum(["content_blocks", "formatted_text"]).optional(),
      })
      .optional(),
    live: liveOutputLimitSchema.optional(),
    artifacts: z.array(toolOutputArtifactSchema).optional(),
    continuation: z
      .object({
        nextOffset: z.number().optional(),
        nextByteOffset: z.number().optional(),
        hint: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type ToolOutputLimitsPayload = z.infer<typeof toolOutputLimitsSchema>;

/** Loose envelope covering the `details.truncation` shapes emitted by file tools. */
export const truncationDetailsSchema = z
  .object({
    truncated: z.boolean().optional(),
    omittedLines: z.number().optional(),
    omittedChars: z.number().optional(),
    omittedBytes: z.number().optional(),
    truncatedLines: z.number().optional(),
    direction: z.enum(["head", "tail", "line", "head_tail"]).optional(),
    partialLine: z.boolean().optional(),
    nextOffset: z.number().optional(),
    nextByteOffset: z.number().optional(),
    maxLines: z.number().optional(),
    maxBytes: z.number().optional(),
    originalChars: z.number().optional(),
    displayedChars: z.number().optional(),
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
    omittedChars: z.number().optional(),
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

const baseEditResultDetailsSchema = z
  .object({
    diff: z.string(),
    firstChangedLine: z.number().optional(),
    lineEnding: z.union([z.literal("\n"), z.literal("\r\n")]),
    bom: z.boolean(),
  })
  .passthrough();

export const editOperationResultSchema = z
  .object({
    index: z.number().int().nonnegative(),
    type: z.enum([
      "replace_text",
      "insert_text",
      "replace_lines",
      "insert_lines",
      "apply_patch",
    ]),
    source: z
      .enum([
        "replacements",
        "insertions",
        "lineReplacements",
        "lineInsertions",
        "patch",
      ])
      .optional(),
    sourceIndex: z.number().int().nonnegative().optional(),
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
export type EditOperationResult = z.infer<typeof editOperationResultSchema>;

export const editOperationResultDetailsSchema =
  baseEditResultDetailsSchema.extend({
    dryRun: z.boolean(),
    operationCount: z.number().int().nonnegative(),
    operations: z.array(editOperationResultSchema),
  });
export type EditOperationResultDetails = z.infer<
  typeof editOperationResultDetailsSchema
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
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      content: z.string().optional(),
      score: z.number().optional(),
    }),
  ),
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

export const jiraTextDisplaySchema = z.string().max(500);

export const jiraIssueSummarySchema = z
  .object({
    key: z.string().min(1),
    id: z.string().optional(),
    summary: jiraTextDisplaySchema.optional(),
    issueType: jiraTextDisplaySchema.optional(),
    status: jiraTextDisplaySchema.optional(),
    statusCategory: jiraTextDisplaySchema.optional(),
    assignee: jiraTextDisplaySchema.optional(),
    priority: jiraTextDisplaySchema.optional(),
    updated: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraIssueSummaryPayload = z.infer<typeof jiraIssueSummarySchema>;

export const jiraProjectSummarySchema = z
  .object({
    key: z.string().min(1),
    id: z.string().optional(),
    name: jiraTextDisplaySchema.optional(),
    projectTypeKey: jiraTextDisplaySchema.optional(),
    lead: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraProjectSummaryPayload = z.infer<
  typeof jiraProjectSummarySchema
>;

export const jiraTransitionSummarySchema = z
  .object({
    id: z.string().min(1),
    name: jiraTextDisplaySchema.optional(),
    to: jiraTextDisplaySchema.optional(),
    toStatusCategory: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraTransitionSummaryPayload = z.infer<
  typeof jiraTransitionSummarySchema
>;

export const jiraUserSummarySchema = z
  .object({
    accountId: z.string().min(1),
    displayName: jiraTextDisplaySchema.optional(),
    emailAddress: jiraTextDisplaySchema.optional(),
    active: z.boolean().optional(),
    accountType: jiraTextDisplaySchema.optional(),
  })
  .passthrough();
export type JiraUserSummaryPayload = z.infer<typeof jiraUserSummarySchema>;

export const jiraFieldSummarySchema = z
  .object({
    id: z.string().min(1),
    name: jiraTextDisplaySchema.optional(),
    key: jiraTextDisplaySchema.optional(),
    required: z.boolean().optional(),
    type: jiraTextDisplaySchema.optional(),
    custom: z.boolean().optional(),
    allowedValues: z.array(jiraTextDisplaySchema).optional(),
  })
  .passthrough();
export type JiraFieldSummaryPayload = z.infer<typeof jiraFieldSummarySchema>;

export const jiraIncludedCountsSchema = z
  .object({
    comments: z.number().int().nonnegative().optional(),
    transitions: z.number().int().nonnegative().optional(),
    statuses: z.number().int().nonnegative().optional(),
    components: z.number().int().nonnegative().optional(),
    versions: z.number().int().nonnegative().optional(),
    issueTypes: z.number().int().nonnegative().optional(),
    fields: z.number().int().nonnegative().optional(),
    priorities: z.number().int().nonnegative().optional(),
    resolutions: z.number().int().nonnegative().optional(),
    worklogs: z.number().int().nonnegative().optional(),
    changelog: z.number().int().nonnegative().optional(),
    remoteLinks: z.number().int().nonnegative().optional(),
    attachments: z.number().int().nonnegative().optional(),
    editmetaFields: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type JiraIncludedCountsPayload = z.infer<
  typeof jiraIncludedCountsSchema
>;

export const jiraResultDetailsSchema = z
  .object({
    jql: z.string().optional(),
    issueCount: z.number().int().nonnegative().optional(),
    displayedIssueCount: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    nextPageToken: z.string().optional(),
    issues: z.array(jiraIssueSummarySchema).optional(),
    users: z.array(jiraUserSummarySchema).optional(),
    userCount: z.number().int().nonnegative().optional(),
    displayedUserCount: z.number().int().nonnegative().optional(),
    issue: jiraIssueSummarySchema.optional(),
    issueKey: z.string().optional(),
    projectKey: z.string().optional(),
    project: jiraProjectSummarySchema.optional(),
    includedCounts: jiraIncludedCountsSchema.optional(),
    issueType: jiraTextDisplaySchema.optional(),
    summary: jiraTextDisplaySchema.optional(),
    id: z.string().optional(),
    self: z.string().optional(),
    updatedFields: z.array(z.string()).optional(),
    updatedFieldCount: z.number().int().nonnegative().optional(),
    commentId: z.string().optional(),
    transition: jiraTransitionSummarySchema.optional(),
    transitions: z.array(jiraTransitionSummarySchema).optional(),
    fields: z.array(jiraFieldSummarySchema).optional(),
    fieldCount: z.number().int().nonnegative().optional(),
    displayedFieldCount: z.number().int().nonnegative().optional(),
    payload: z.unknown().optional(),
    dryRun: z.boolean().optional(),
    resolvedAssignee: jiraUserSummarySchema.optional(),
    comment: z.unknown().optional(),
    transitionCount: z.number().int().nonnegative().optional(),
    displayedTransitionCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type JiraResultDetailsPayload = z.infer<typeof jiraResultDetailsSchema>;

export const confluenceTextDisplaySchema = z.string().max(500);

export const confluenceSpaceSummarySchema = z
  .object({
    id: z.string().min(1),
    key: confluenceTextDisplaySchema.optional(),
    name: confluenceTextDisplaySchema.optional(),
    type: confluenceTextDisplaySchema.optional(),
    status: confluenceTextDisplaySchema.optional(),
    homepageId: z.string().optional(),
  })
  .passthrough();
export type ConfluenceSpaceSummaryPayload = z.infer<
  typeof confluenceSpaceSummarySchema
>;

export const confluencePageSummarySchema = z
  .object({
    id: z.string().min(1),
    title: confluenceTextDisplaySchema.optional(),
    spaceId: z.string().optional(),
    spaceKey: confluenceTextDisplaySchema.optional(),
    parentId: z.string().optional(),
    status: confluenceTextDisplaySchema.optional(),
    versionNumber: z.number().int().nonnegative().optional(),
    webui: z.string().optional(),
    storagePath: z.string().optional(),
    markdownPath: z.string().optional(),
    attachmentDir: z.string().optional(),
  })
  .passthrough();
export type ConfluencePageSummaryPayload = z.infer<
  typeof confluencePageSummarySchema
>;

export const confluenceAttachmentSummarySchema = z
  .object({
    id: z.string().optional(),
    fileId: z.string().optional(),
    filename: confluenceTextDisplaySchema.optional(),
    title: confluenceTextDisplaySchema.optional(),
    mediaType: confluenceTextDisplaySchema.optional(),
    fileSize: z.number().int().nonnegative().optional(),
    versionNumber: z.number().int().nonnegative().optional(),
    downloadLink: z.string().optional(),
    path: z.string().optional(),
    snippet: z.string().optional(),
  })
  .passthrough();
export type ConfluenceAttachmentSummaryPayload = z.infer<
  typeof confluenceAttachmentSummarySchema
>;

export const confluenceIncludedCountsSchema = z
  .object({
    pages: z.number().int().nonnegative().optional(),
    spaces: z.number().int().nonnegative().optional(),
    labels: z.number().int().nonnegative().optional(),
    properties: z.number().int().nonnegative().optional(),
    operations: z.number().int().nonnegative().optional(),
    versions: z.number().int().nonnegative().optional(),
    directChildren: z.number().int().nonnegative().optional(),
    attachments: z.number().int().nonnegative().optional(),
    downloadedAttachments: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type ConfluenceIncludedCountsPayload = z.infer<
  typeof confluenceIncludedCountsSchema
>;

export const confluencePublishOutcomeSchema = z
  .object({
    index: z.number().int().nonnegative().optional(),
    operation: confluenceTextDisplaySchema.optional(),
    id: z.string().optional(),
    title: confluenceTextDisplaySchema.optional(),
    status: z
      .enum(["created", "updated", "dry_run", "skipped", "error"])
      .optional(),
    message: z.string().optional(),
    errorCode: z.string().optional(),
  })
  .passthrough();
export type ConfluencePublishOutcomePayload = z.infer<
  typeof confluencePublishOutcomeSchema
>;

export const confluenceResultDetailsSchema = z
  .object({
    action: confluenceTextDisplaySchema.optional(),
    query: confluenceTextDisplaySchema.optional(),
    cql: z.string().optional(),
    pageId: z.string().optional(),
    spaceId: z.string().optional(),
    spaceKey: confluenceTextDisplaySchema.optional(),
    title: confluenceTextDisplaySchema.optional(),
    status: confluenceTextDisplaySchema.optional(),
    bodyFormat: confluenceTextDisplaySchema.optional(),
    spaces: z.array(confluenceSpaceSummarySchema).optional(),
    space: confluenceSpaceSummarySchema.optional(),
    spaceCount: z.number().int().nonnegative().optional(),
    displayedSpaceCount: z.number().int().nonnegative().optional(),
    pages: z.array(confluencePageSummarySchema).optional(),
    page: confluencePageSummarySchema.optional(),
    pageCount: z.number().int().nonnegative().optional(),
    displayedPageCount: z.number().int().nonnegative().optional(),
    attachments: z.array(confluenceAttachmentSummarySchema).optional(),
    attachment: confluenceAttachmentSummarySchema.optional(),
    attachmentCount: z.number().int().nonnegative().optional(),
    displayedAttachmentCount: z.number().int().nonnegative().optional(),
    includedCounts: confluenceIncludedCountsSchema.optional(),
    downloadDir: z.string().optional(),
    manifestPath: z.string().optional(),
    pagesJsonlPath: z.string().optional(),
    inputPath: z.string().optional(),
    outcomes: z.array(confluencePublishOutcomeSchema).optional(),
    outcomeCount: z.number().int().nonnegative().optional(),
    displayedOutcomeCount: z.number().int().nonnegative().optional(),
    payload: z.unknown().optional(),
    dryRun: z.boolean().optional(),
    outputLimits: toolOutputLimitsSchema.optional(),
  })
  .passthrough();
export type ConfluenceResultDetailsPayload = z.infer<
  typeof confluenceResultDetailsSchema
>;

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
  releasedPorts: z.array(taskListeningPortSchema).optional(),
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
  thinkingLevel: thinkingLevelSchema.optional(),
  stopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  steps: z.array(exploreStepSchema).optional(),
});
export type ExploreReportPayload = z.infer<typeof exploreReportSchema>;

/** Compact public lifecycle projection. Unknown legacy full-report fields are stripped. */
export const exploreReportSummarySchema = z.object({
  agentId: z.string().startsWith("agent_"),
  task: z.string().max(2_048),
  label: z.string().max(256).optional(),
  status: z.enum(["completed", "failed", "aborted"]).default("completed"),
  reportPath: z.string().min(1).max(4_096).optional(),
  summaryPreview: z.string().max(1_024).optional(),
  usage: exploreUsageStatsSchema.optional(),
  model: z.string().max(256).optional(),
  thinkingLevel: thinkingLevelSchema.optional(),
  stopReason: z.string().max(128).optional(),
  errorMessage: z.string().max(2_048).optional(),
});
export type ExploreReportSummaryPayload = z.infer<
  typeof exploreReportSummarySchema
>;

export const exploreResultSchema = z.object({
  reports: z.array(exploreReportSchema),
  contentBlocks: z.array(toolContentBlockSchema).optional(),
  details: z
    .object({ outputLimits: toolOutputLimitsSchema.optional() })
    .passthrough()
    .optional(),
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
