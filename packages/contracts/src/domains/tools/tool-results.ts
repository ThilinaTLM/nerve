import { z } from "zod";
import { userInputAnswerSchema } from "../core/tool-call.js";
import { modelSelectionSchema } from "../models/models.js";
import { launchStatusSchema } from "../launches/launch.js";

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

export const toolArtifactClaimSchema = z
  .object({
    id: z.string().min(1).optional(),
    role: z.enum(["primary_result", "supporting_data", "overflow_recovery"]),
    path: z.string().min(1).optional(),
    logicalPath: z.string().min(1).optional(),
    format: z.object({
      kind: z.enum([
        "markdown",
        "text",
        "json",
        "jsonl",
        "image",
        "binary",
        "directory_manifest",
      ]),
      mediaType: z.string().min(1),
      encoding: z.literal("utf-8").optional(),
    }),
    bytes: z.number().int().nonnegative().optional(),
    lines: z.number().int().nonnegative().optional(),
    items: z.number().int().nonnegative().optional(),
    itemKind: z.string().min(1).optional(),
    label: z.string().min(1).max(256),
    recommendedTools: z.array(z.enum(["read", "grep", "explain_image"])).max(3),
  })
  .refine((claim) => Boolean(claim.path || claim.logicalPath), {
    message: "Artifact claims require a path or logicalPath.",
  });
export type ToolArtifactClaim = z.infer<typeof toolArtifactClaimSchema>;

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
    artifacts: z
      .array(z.union([toolArtifactClaimSchema, toolOutputArtifactSchema]))
      .optional(),
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
    diff: z.string().optional(),
    firstChangedLine: z.number().optional(),
    lineEnding: z.union([z.literal("\n"), z.literal("\r\n")]).optional(),
    bom: z.boolean().optional(),
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
        "edits",
      ])
      .optional(),
    sourceIndex: z.number().int().nonnegative().optional(),
    status: z.enum(["applied", "failed", "not_applied"]).optional(),
    error: z.string().optional(),
    matchMode: z.enum(["exact", "trimmed", "whitespace"]).optional(),
    occurrence: z.number().int().positive().optional(),
    matchCount: z.number().int().nonnegative().optional(),
    startLine: z.number().int().positive().optional(),
    endLine: z.number().int().positive().optional(),
    matchedBy: z
      .enum(["unique", "occurrence", "line_range", "line_insert", "patch"])
      .optional(),
  })
  .passthrough();
export type EditOperationResult = z.infer<typeof editOperationResultSchema>;

export const editOperationResultDetailsSchema =
  baseEditResultDetailsSchema.extend({
    dryRun: z.boolean().optional(),
    appliedCount: z.number().int().nonnegative().optional(),
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
      status: launchStatusSchema,
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

export const writeResultDetailsSchema = z.looseObject({
  outcome: z.enum(["created", "overwritten"]).optional(),
  bytes: z.number().int().nonnegative().optional(),
});
export const grepResultDetailsSchema = z.looseObject({
  totalMatches: z.number().int().nonnegative().optional(),
  totalFiles: z.number().int().nonnegative().optional(),
});
export const findResultDetailsSchema = z.looseObject({
  totalEntries: z.number().int().nonnegative().optional(),
});
const subagentAssignmentResultSchema = z.object({
  name: z.string(),
  profile: z.string().optional(),
  disposition: z.enum(["created", "follow_up", "rejected"]),
  agentId: z.string().optional(),
  reason: z.string().optional(),
});
export const subagentPromptResultDetailsSchema = z.looseObject({
  assignments: z.array(subagentAssignmentResultSchema).optional(),
});
const subagentStatusEntrySchema = z.object({
  name: z.string(),
  agentId: z.string().optional(),
  profile: z.string().optional(),
  state: z.enum([
    "running",
    "waiting",
    "idle",
    "stopped",
    "failed",
    "interrupted",
  ]),
  contextPercent: z.number().min(0).max(100).optional(),
  lastActivityAt: z.string().datetime().optional(),
});
export const subagentStatusResultDetailsSchema = z.looseObject({
  agents: z.array(subagentStatusEntrySchema).optional(),
});
const subagentStopEntrySchema = z.object({
  name: z.string(),
  outcome: z.enum(["stopped", "already_idle", "not_found", "failed"]),
  runMs: z.number().nonnegative().optional(),
  reason: z.string().optional(),
});
export const subagentStopResultDetailsSchema = z.looseObject({
  results: z.array(subagentStopEntrySchema).optional(),
});

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

export const readRangeSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("lines"),
    requestedStartLine: z.number().int().positive(),
    requestedLimit: z.number().int().positive(),
    sourceTotalLines: z.number().int().nonnegative(),
    returnedStartLine: z.number().int().positive(),
    returnedEndLine: z.number().int().nonnegative(),
    returnedContentLines: z.number().int().nonnegative(),
    sourceEndsWithNewline: z.boolean(),
    nextOffset: z.number().int().positive().optional(),
    nextByteOffset: z.number().int().nonnegative().optional(),
  }),
  z.object({
    mode: z.literal("bytes"),
    requestedByteOffset: z.number().int().nonnegative(),
    requestedByteLimit: z.number().int().positive(),
    sourceBytes: z.number().int().nonnegative(),
    returnedByteStart: z.number().int().nonnegative(),
    returnedByteEnd: z.number().int().nonnegative(),
    utf8AdjustedStart: z.number().int().nonnegative(),
    utf8AdjustedEnd: z.number().int().nonnegative(),
    nextByteOffset: z.number().int().nonnegative().optional(),
  }),
]);
export type ReadRange = z.infer<typeof readRangeSchema>;

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

/** Result of ask_user (resolved question). */
export const askUserResultSchema = z.object({
  questions: z.array(
    z.object({
      id: z.string(),
      question: z.string(),
      answer: userInputAnswerSchema.optional(),
      skipped: z.literal(true).optional(),
    }),
  ),
  dismissed: z.boolean().optional(),
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
