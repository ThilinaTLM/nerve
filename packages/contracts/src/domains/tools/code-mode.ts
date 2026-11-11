import { z } from "zod";

/** One SDK call a code-mode script made through the host broker. */
export const codeModeHostCallSchema = z
  .object({
    /** SDK method, e.g. `jira.issues.search`. */
    method: z.string(),
    /** Direct tool the call was authorized as, e.g. `jira_search_issues`. */
    authorizedAs: z.string().optional(),
    /** Short argument summary for display (JQL, issue key). */
    summary: z.string().optional(),
    outcome: z.enum(["completed", "failed", "denied"]),
    error: z.string().optional(),
    durationMs: z.number().nonnegative(),
  })
  .passthrough();
export type CodeModeHostCall = z.infer<typeof codeModeHostCallSchema>;

/** A Confluence page the script wrote, with the linter's report. */
export const codeModePageReportSchema = z.object({
  action: z.enum(["created", "updated"]),
  id: z.string(),
  title: z.string(),
  version: z.number().nullable(),
  fixes: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type CodeModePageReport = z.infer<typeof codeModePageReportSchema>;

/** A file the script wrote to the conversation's code-mode artifact folder. */
export const codeModeArtifactSchema = z.object({
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
export type CodeModeArtifact = z.infer<typeof codeModeArtifactSchema>;

export const codeModeResultDetailsSchema = z
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
    hostCalls: z.array(codeModeHostCallSchema),
    pages: z.array(codeModePageReportSchema).optional(),
    artifacts: z.array(codeModeArtifactSchema).optional(),
    /** Entities the run created (`SCRUM-6`, `comment 77 on SCRUM-6`); pages are in `pages`. */
    created: z.array(z.string()).optional(),
  })
  .passthrough();
export type CodeModeResultDetails = z.infer<typeof codeModeResultDetailsSchema>;
