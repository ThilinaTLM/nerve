import { z } from "zod";

/**
 * One problem with one configurable thing (a file, a profile, a skill, an extension).
 * Every owner reports in this shape. Where the problem is (scope, file, resource)
 * belongs to whatever carries the diagnostic, not to the diagnostic.
 */
export const diagnosticSchema = z.strictObject({
  /** `error`: the resource does not load. `warning`: it loads and probably does not do what was meant. */
  level: z.enum(["error", "warning"]),
  /** Stable, kebab-case; each owner defines its own codes. */
  code: z.string().min(1),
  /** What is wrong and what to do, for the agent and the user. */
  message: z.string().min(1),
  /** JSON pointer or line into the file, when known. */
  pointer: z.string().optional(),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

/** A diagnostic from a loader that scans many files and returns one flat list. */
export const fileDiagnosticSchema = diagnosticSchema.extend({
  path: z.string().min(1),
});
export type FileDiagnostic = z.infer<typeof fileDiagnosticSchema>;
