import { z } from "zod";

/** Where a skill definition comes from, independent of who enabled it. */
export const skillSourceSchema = z.enum([
  "user",
  "project",
  "nerve",
  "agentBrowser",
]);
export type SkillSource = z.infer<typeof skillSourceSchema>;

export const availableSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  filePath: z.string().min(1),
  source: skillSourceSchema,
  /**
   * Project skills only. `pending`: never approved. `changed`: its files differ from what was
   * approved. Either way the agent is not told about the skill until the user approves it.
   */
  approval: z.enum(["pending", "changed"]).optional(),
});
export type AvailableSkill = z.infer<typeof availableSkillSchema>;

export const availableSkillsResponseSchema = z.object({
  skills: z.array(availableSkillSchema),
});
export type AvailableSkillsResponse = z.infer<
  typeof availableSkillsResponseSchema
>;

/** One file of a skill folder, as the review lists it. */
export const skillReviewFileSchema = z.strictObject({
  /** Relative to the skill folder, with `/`. */
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  /** Something the skill can tell the agent to run: an executable file or a script by extension. */
  script: z.boolean(),
});
export const skillReviewRequestSchema = z.strictObject({
  projectId: z.string().min(1),
  name: z.string().min(1),
});
/** What the user approves when they approve a project skill. */
export const skillReviewSchema = z.strictObject({
  name: z.string().min(1),
  /** All the agent is told about an approved skill until it applies it. */
  description: z.string(),
  /** The skill folder: the `resourceKey` of the trust decision. */
  folder: z.string().min(1),
  /** `sha256:<hex>` over every file below; the `contentDigest` of the trust decision. */
  contentDigest: z.string().min(1),
  status: z.enum(["pending", "changed", "approved"]),
  files: z.array(skillReviewFileSchema),
});
export type SkillReview = z.infer<typeof skillReviewSchema>;
export type SkillReviewFile = z.infer<typeof skillReviewFileSchema>;

/** Capability overrides bucket file skills together regardless of directory. */
export const skillOverrideKind = (
  source: SkillSource,
): "file" | "nerve" | "agentBrowser" =>
  source === "agentBrowser"
    ? "agentBrowser"
    : source === "nerve"
      ? "nerve"
      : "file";

/** Display order of skill sources: the user's own skills first (project,
 * then user), then Agent Browser guidance, then built-in Nerve skills. */
export const skillSourceOrder: readonly SkillSource[] = [
  "project",
  "user",
  "agentBrowser",
  "nerve",
];

/** Stable sort into `skillSourceOrder`. */
export function sortBySkillSource<T extends { source: SkillSource }>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      skillSourceOrder.indexOf(a.source) - skillSourceOrder.indexOf(b.source),
  );
}
