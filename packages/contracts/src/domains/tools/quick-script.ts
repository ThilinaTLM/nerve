import { z } from "zod";

/**
 * An SDK operation a script contains, as the admission scan found it, for the
 * approval and the tool card. `targets` are normalized resources
 * (`jira:issue/SCRUM-1`); `targetsKnown` is false when some call's targets are
 * not statically known (they are checked when the call runs).
 */
export const quickScriptOperationSchema = z.object({
  /** `<namespace>.<path>`, e.g. `jira.comments.add`. */
  operation: z.string(),
  targets: z.array(z.string()),
  targetsKnown: z.boolean(),
  /** Number of calls in the script. */
  count: z.number().int().positive(),
});
export type QuickScriptOperation = z.infer<typeof quickScriptOperationSchema>;

/** One SDK call a quick-script script made through the host broker. */
export const quickScriptHostCallSchema = z
  .object({
    /** SDK method, e.g. `jira.issues.search`. */
    method: z.string(),
    /** Normalized resources the call was authorized for, e.g. `jira:issue/APP-12`. */
    targets: z.array(z.string()).optional(),
    /** Set only when the call was authorized as a remaining direct tool (`web_fetch`, `write`); older records name the tool for every call. */
    authorizedAs: z.string().optional(),
    /** Short argument summary for display (JQL, issue key). */
    summary: z.string().optional(),
    outcome: z.enum(["completed", "failed", "denied"]),
    error: z.string().optional(),
    durationMs: z.number().nonnegative(),
  })
  .passthrough();
export type QuickScriptHostCall = z.infer<typeof quickScriptHostCallSchema>;

/** A file the script wrote to the conversation's quick-script artifact folder. */
export const quickScriptArtifactSchema = z.object({
  /** `artifact:<name>`, the handle scripts use. */
  handle: z.string(),
  /** Absolute host path, for previews and opening in a tab. */
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  mediaType: z.string(),
  /** Pixel size of PNG/JPEG artifacts, for previews. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type QuickScriptArtifact = z.infer<typeof quickScriptArtifactSchema>;

export const quickScriptResultDetailsSchema = z
  .object({
    status: z.enum([
      "completed",
      "failed",
      "timed_out",
      "cancelled",
      "memory_limit",
    ]),
    error: z.string().optional(),
    durationMs: z.number().nonnegative(),
    memoryUsedBytes: z.number().nonnegative().optional(),
    outputTruncated: z.boolean().optional(),
    hostCalls: z.array(quickScriptHostCallSchema),
    artifacts: z.array(quickScriptArtifactSchema).optional(),
    /** Entities the run created (`SCRUM-6`, `comment 77 on SCRUM-6`). */
    created: z.array(z.string()).optional(),
  })
  .passthrough();
export type QuickScriptResultDetails = z.infer<
  typeof quickScriptResultDetailsSchema
>;
