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
  })
  .passthrough();
export type CodeModeResultDetails = z.infer<typeof codeModeResultDetailsSchema>;
