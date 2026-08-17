import { z } from "zod";
import {
  confluenceAttachmentSummarySchema,
  confluenceCommentSummarySchema,
  confluenceLabelSummarySchema,
  confluencePageSummarySchema,
  confluencePropertySummarySchema,
  confluenceRestrictionSummarySchema,
  confluenceSpaceSummarySchema,
  confluenceTextDisplaySchema,
  jiraAttachmentSummarySchema,
  jiraBoardSummarySchema,
  jiraChangelogSummarySchema,
  jiraCommentSummarySchema,
  jiraFieldSummarySchema,
  jiraIssueLinkSummarySchema,
  jiraIssueSummarySchema,
  jiraIssueTypeSummarySchema,
  jiraProjectSummarySchema,
  jiraRemoteLinkSummarySchema,
  jiraSprintSummarySchema,
  jiraTextDisplaySchema,
  jiraTransitionSummarySchema,
  jiraUserSummarySchema,
  jiraWorklogSummarySchema,
} from "./atlassian-result-summaries.schema.js";
export * from "./atlassian-result-summaries.schema.js";
import { modelSelectionSchema, thinkingLevelSchema } from "../models/index.js";
import {
  taskListeningPortSchema,
  taskLogQueryResponseSchema,
  taskRecordSchema,
  taskStatusSchema,
} from "../tasks/index.js";
import { taskCancelOutcomeSchema } from "./task-tool-previews.schema.js";

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

export const bashExecutionDispositionSchema = z.discriminatedUnion(
  "disposition",
  [
    z.object({ disposition: z.literal("completed") }),
    z.object({
      disposition: z.literal("backgrounded"),
      taskId: z.string().startsWith("task_"),
      status: taskStatusSchema,
      elapsedMs: z.number().nonnegative(),
      terminalUpdate: z.literal("automatic"),
    }),
  ],
);
export type BashExecutionDisposition = z.infer<
  typeof bashExecutionDispositionSchema
>;

export const bashResultDetailsSchema = z
  .object({
    truncation: truncationDetailsSchema.optional(),
    fullOutputPath: z.string().optional(),
    rawResultPath: z.string().optional(),
    signal: z.string().nullable().optional(),
    execution: bashExecutionDispositionSchema.optional(),
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

export const explainImageResultDetailsSchema = z.object({
  path: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int().nonnegative(),
  model: modelSelectionSchema,
  explanation: z.string(),
});
export type ExplainImageResultDetails = z.infer<
  typeof explainImageResultDetailsSchema
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
    issueLinks: z.number().int().nonnegative().optional(),
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
    searchScope: z.enum(["issue", "project", "directory"]).optional(),
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
    issueTypes: z.array(jiraIssueTypeSummarySchema).optional(),
    issueTypeCount: z.number().int().nonnegative().optional(),
    displayedIssueTypeCount: z.number().int().nonnegative().optional(),
    fieldCount: z.number().int().nonnegative().optional(),
    displayedFieldCount: z.number().int().nonnegative().optional(),
    payload: z.unknown().optional(),
    dryRun: z.boolean().optional(),
    resolvedAssignee: jiraUserSummarySchema.optional(),
    operation: jiraTextDisplaySchema.optional(),
    boardId: z.string().optional(),
    board: jiraBoardSummarySchema.optional(),
    boards: z.array(jiraBoardSummarySchema).optional(),
    boardCount: z.number().int().nonnegative().optional(),
    displayedBoardCount: z.number().int().nonnegative().optional(),
    startAt: z.number().int().nonnegative().optional(),
    maxResults: z.number().int().nonnegative().optional(),
    sprintId: z.string().optional(),
    sprint: jiraSprintSummarySchema.optional(),
    sprints: z.array(jiraSprintSummarySchema).optional(),
    sprintCount: z.number().int().nonnegative().optional(),
    displayedSprintCount: z.number().int().nonnegative().optional(),
    backlogIssues: z.array(jiraIssueSummarySchema).optional(),
    backlogCount: z.number().int().nonnegative().optional(),
    attachmentId: z.string().optional(),
    attachment: jiraAttachmentSummarySchema.optional(),
    attachments: z.array(jiraAttachmentSummarySchema).optional(),
    filename: jiraTextDisplaySchema.optional(),
    mediaType: jiraTextDisplaySchema.optional(),
    bytes: z.number().int().nonnegative().optional(),
    path: z.string().optional(),
    commentSummary: jiraCommentSummarySchema.optional(),
    comments: z.array(jiraCommentSummarySchema).optional(),
    displayedCommentCount: z.number().int().nonnegative().optional(),
    worklogId: z.string().optional(),
    worklog: jiraWorklogSummarySchema.optional(),
    worklogs: z.array(jiraWorklogSummarySchema).optional(),
    displayedWorklogCount: z.number().int().nonnegative().optional(),
    changelogEntries: z.array(jiraChangelogSummarySchema).optional(),
    displayedChangelogCount: z.number().int().nonnegative().optional(),
    issueLink: jiraIssueLinkSummarySchema.optional(),
    issueLinks: z.array(jiraIssueLinkSummarySchema).optional(),
    displayedIssueLinkCount: z.number().int().nonnegative().optional(),
    remoteLinks: z.array(jiraRemoteLinkSummarySchema).optional(),
    displayedRemoteLinkCount: z.number().int().nonnegative().optional(),
    linkId: z.string().optional(),
    otherIssueKey: z.string().optional(),
    linkType: jiraTextDisplaySchema.optional(),
    direction: z.enum(["outward", "inward"]).optional(),
    rankBeforeIssueKey: z.string().optional(),
    rankAfterIssueKey: z.string().optional(),
    previousState: jiraTextDisplaySchema.optional(),
    resultingState: jiraTextDisplaySchema.optional(),
    comment: z.unknown().optional(),
    transitionCount: z.number().int().nonnegative().optional(),
    displayedTransitionCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type JiraResultDetailsPayload = z.infer<typeof jiraResultDetailsSchema>;

export const confluenceIncludedCountsSchema = z
  .object({
    pages: z.number().int().nonnegative().optional(),
    spaces: z.number().int().nonnegative().optional(),
    labels: z.number().int().nonnegative().optional(),
    properties: z.number().int().nonnegative().optional(),
    operations: z.number().int().nonnegative().optional(),
    versions: z.number().int().nonnegative().optional(),
    directChildren: z.number().int().nonnegative().optional(),
    footerComments: z.number().int().nonnegative().optional(),
    inlineComments: z.number().int().nonnegative().optional(),
    restrictions: z.number().int().nonnegative().optional(),
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
    childPages: z.array(confluencePageSummarySchema).optional(),
    displayedChildPageCount: z.number().int().nonnegative().optional(),
    footerComments: z.array(confluenceCommentSummarySchema).optional(),
    displayedFooterCommentCount: z.number().int().nonnegative().optional(),
    inlineComments: z.array(confluenceCommentSummarySchema).optional(),
    displayedInlineCommentCount: z.number().int().nonnegative().optional(),
    properties: z.array(confluencePropertySummarySchema).optional(),
    displayedPropertyCount: z.number().int().nonnegative().optional(),
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
    operation: confluenceTextDisplaySchema.optional(),
    commentId: z.string().optional(),
    comment: confluenceCommentSummarySchema.optional(),
    kind: z.enum(["footer", "inline"]).optional(),
    label: confluenceTextDisplaySchema.optional(),
    labels: z.array(confluenceLabelSummarySchema).optional(),
    labelCount: z.number().int().nonnegative().optional(),
    prefix: confluenceTextDisplaySchema.optional(),
    restrictionOperation: z.enum(["read", "update"]).optional(),
    subjectType: z.enum(["user", "group"]).optional(),
    subjectId: z.string().optional(),
    restrictions: z.array(confluenceRestrictionSummarySchema).optional(),
    restrictionCount: z.number().int().nonnegative().optional(),
    previousStatus: confluenceTextDisplaySchema.optional(),
    resultingStatus: confluenceTextDisplaySchema.optional(),
    attachmentId: z.string().optional(),
    filename: confluenceTextDisplaySchema.optional(),
    newFilename: confluenceTextDisplaySchema.optional(),
    bytes: z.number().int().nonnegative().optional(),
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
/** Exact dispatcher result of task_start. */
export const taskStartToolResultSchema = z
  .object({
    task: taskRecordSchema,
    contentBlocks: z.array(toolContentBlockSchema).optional(),
  })
  .strict();
export type TaskStartToolResult = z.infer<typeof taskStartToolResultSchema>;

/** Exact dispatcher result of task_status. */
export const taskStatusToolResultSchema = z
  .object({
    tasks: z.array(taskRecordSchema),
    contentBlocks: z.array(toolContentBlockSchema).optional(),
  })
  .strict();
export type TaskStatusToolResult = z.infer<typeof taskStatusToolResultSchema>;

/** Exact dispatcher result of task_cancel. */
export const taskCancelToolResultSchema = z
  .object({
    tasks: z.array(taskRecordSchema),
    cancelResults: z.array(taskCancelResultSchema),
    contentBlocks: z.array(toolContentBlockSchema).optional(),
  })
  .strict();
export type TaskCancelToolResult = z.infer<typeof taskCancelToolResultSchema>;

/** Exact dispatcher result of task_restart. */
export const taskRestartToolResultSchema = z
  .object({
    task: taskRecordSchema,
    restartedFromTaskId: z.string().startsWith("task_"),
    newTaskId: z.string().startsWith("task_"),
    restartRootTaskId: z.string().startsWith("task_"),
    contentBlocks: z.array(toolContentBlockSchema).optional(),
  })
  .strict();
export type TaskRestartToolResult = z.infer<typeof taskRestartToolResultSchema>;

/** Exact dispatcher result of task_logs. */
export const taskLogsToolResultSchema = taskLogQueryResponseSchema
  .extend({
    contentBlocks: z.array(toolContentBlockSchema).optional(),
  })
  .strict();
export type TaskLogsToolResult = z.infer<typeof taskLogsToolResultSchema>;

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

/** Compact Explore result used by bounded transcript previews. */
export const exploreResultPreviewSchema = exploreResultSchema.extend({
  reports: z.array(exploreReportSummarySchema),
});
export type ExploreResultPreviewPayload = z.infer<
  typeof exploreResultPreviewSchema
>;

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
