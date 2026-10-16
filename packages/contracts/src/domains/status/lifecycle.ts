import { z } from "zod";

/**
 * Server lifecycle, owned by the workbench server and rendered by the web app.
 *
 * The server binds HTTP before storage opens. Until `ready`, it serves only
 * static assets, `/health`, `/api/health`, `/api/lifecycle`, and
 * `POST /api/lifecycle/retry`, `POST /api/lifecycle/rollback`; every other
 * API route answers 503 with
 * `{ error: "starting", lifecycle }`. A failed upgrade keeps the process alive
 * in `failed` so any client can show details and retry.
 */
export const serverLifecycleStateSchema = z.enum([
  "starting",
  "upgrading",
  "ready",
  "failed",
]);
export type ServerLifecycleState = z.infer<typeof serverLifecycleStateSchema>;

export const serverLifecycleProgressSchema = z.object({
  /** Migration step id, e.g. `0001-conversation-core`. */
  step: z.string(),
  /** Human label of the current phase, e.g. "Importing conversations". */
  label: z.string(),
  done: z.number().nonnegative().optional(),
  total: z.number().nonnegative().optional(),
});
export type ServerLifecycleProgress = z.infer<
  typeof serverLifecycleProgressSchema
>;

/**
 * One unit startup could not use. Discarding a `conversation` deletes it;
 * discarding a `configuration` file sets it aside (`id` is its absolute path)
 * so Nerve continues with defaults.
 */
export const serverLifecycleDiscardableSchema = z.object({
  kind: z.enum(["conversation", "configuration"]),
  id: z.string(),
  title: z.string().optional(),
  reason: z.string(),
});
export type ServerLifecycleDiscardable = z.infer<
  typeof serverLifecycleDiscardableSchema
>;

/** Terminal code after a user-requested rollback; the process must be quit. */
export const MIGRATION_ROLLED_BACK = "MIGRATION_ROLLED_BACK";

export const serverLifecycleFailureSchema = z.object({
  code: z.string(),
  message: z.string(),
  step: z.string().optional(),
  phase: z.string().optional(),
  /** Absolute path of the persisted failure report, when one was written. */
  reportPath: z.string().optional(),
  retryable: z.boolean(),
  /**
   * Only these units failed. Retrying with all of their IDs in `discardIds`
   * continues without them.
   */
  discardable: z.array(serverLifecycleDiscardableSchema).optional(),
  /** `POST /api/lifecycle/rollback` can restore the previous version's data. */
  rollbackAvailable: z.boolean().optional(),
});
export type ServerLifecycleFailure = z.infer<
  typeof serverLifecycleFailureSchema
>;

export const serverLifecycleSchema = z.object({
  state: serverLifecycleStateSchema,
  /** Server build version; clients reload when it changes across restarts. */
  version: z.string(),
  /** ISO time the server process started; changes on every restart. */
  startedAt: z.string(),
  /** One-line human status, e.g. "Upgrading local storage". */
  message: z.string(),
  progress: serverLifecycleProgressSchema.optional(),
  failure: serverLifecycleFailureSchema.optional(),
});
export type ServerLifecycle = z.infer<typeof serverLifecycleSchema>;

/** Optional body of `POST /api/lifecycle/retry`. */
export const serverLifecycleRetryRequestSchema = z
  .object({
    /** IDs from `failure.discardable` to discard before retrying. */
    discardIds: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();
export type ServerLifecycleRetryRequest = z.infer<
  typeof serverLifecycleRetryRequestSchema
>;

/** Body of `/health` (public) and `/api/health` (authenticated) in every state. */
export const serverHealthSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  lifecycle: serverLifecycleStateSchema,
});
export type ServerHealth = z.infer<typeof serverHealthSchema>;

/** 503 body for API routes requested before the server is `ready`. */
export const serverStartingErrorSchema = z.object({
  error: z.literal("starting"),
  lifecycle: serverLifecycleSchema,
});
export type ServerStartingError = z.infer<typeof serverStartingErrorSchema>;
