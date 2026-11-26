import { z } from "zod";
import { trustStateSchema } from "../core/trust-state.js";
import { configurationResourceKindSchema } from "./resource.js";

/**
 * One reviewable configuration item, as the user's review addresses it. Same identity as
 * a `ConfigurationResource` (kind, scope and id), plus the project for project scope.
 */
export const configurationReviewTargetSchema = z.strictObject({
  kind: configurationResourceKindSchema,
  scope: z.enum(["user", "project"]),
  /** Required for project scope. */
  projectId: z.string().optional(),
  /** The resource's `id`: a name, or the file name for single-file kinds. */
  id: z.string().min(1),
});
export type ConfigurationReviewTarget = z.infer<
  typeof configurationReviewTargetSchema
>;

/** One thing the item can do, in plain language, written by its owner on the server. */
export const configurationReviewItemSchema = z.strictObject({
  /** The full sentence the review dialog shows: "Runs without asking: requires the autonomous rule set". */
  text: z.string().min(1),
  /** At most 32 characters, for the bell island and list rows: "Runs without asking". */
  short: z.string().min(1).max(32),
  /** Widens what agents can run, reach or change without asking. Listed first, in warning tone. */
  broad: z.boolean(),
  /** Not in what the user approved last time (the stored review snapshot). */
  new: z.boolean(),
});
export type ConfigurationReviewItem = z.infer<
  typeof configurationReviewItemSchema
>;

/** A file the decision covers; the dialog links it instead of showing its content. */
export const configurationReviewSourceSchema = z.strictObject({
  /** Absolute path, opened by the file viewer. */
  path: z.string().min(1),
  /** Shorter display path (relative to the item's folder, or `~`-prefixed). */
  label: z.string().min(1),
  bytes: z.number().int().nonnegative().optional(),
  /** A file the agent may run (skill scripts, an extension's code). */
  script: z.boolean().optional(),
});
export type ConfigurationReviewSource = z.infer<
  typeof configurationReviewSourceSchema
>;

/**
 * What the user reviews before trusting one item: what it can do and where its source is.
 * No embedded source. Every kind returns this shape, so the app has one review dialog.
 */
export const configurationReviewSchema = z.strictObject({
  target: configurationReviewTargetSchema,
  /** Display name: the profile label, skill name, server name or file name. */
  name: z.string().min(1),
  /** The kind in the user's words: "Sub-agent profile", "Permission rules", "MCP server". */
  kindLabel: z.string().min(1),
  state: trustStateSchema,
  /** The content differs from the version last trusted or declined. */
  changedSinceDecision: z.boolean(),
  /** Last change on disk (ISO datetime), when known. */
  changedAt: z.string().datetime().optional(),
  /** Broad items first. Empty only for an item with nothing to report. */
  items: z.array(configurationReviewItemSchema),
  sources: z.array(configurationReviewSourceSchema),
  /** What a decision applies to; `configuration.decide` refuses a stale digest. */
  digest: z.string().min(1),
});
export type ConfigurationReview = z.infer<typeof configurationReviewSchema>;

/** The user's decision on exactly the reviewed content. User UI only; never an agent surface. */
export const configurationDecisionSchema = z.strictObject({
  target: configurationReviewTargetSchema,
  digest: z.string().min(1),
  /** `true` trusts this version; `false` declines it (also how a trusted item is revoked). */
  trusted: z.boolean(),
});
export type ConfigurationDecision = z.infer<typeof configurationDecisionSchema>;
