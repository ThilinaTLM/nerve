import { z } from "zod";

/** Where a skill definition comes from, independent of who enabled it. */
export const skillSourceSchema = z.enum(["user", "project", "agentBrowser"]);
export type SkillSource = z.infer<typeof skillSourceSchema>;

export const availableSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  filePath: z.string().min(1),
  source: skillSourceSchema,
});
export type AvailableSkill = z.infer<typeof availableSkillSchema>;

export const availableSkillsResponseSchema = z.object({
  skills: z.array(availableSkillSchema),
});
export type AvailableSkillsResponse = z.infer<
  typeof availableSkillsResponseSchema
>;

/** Capability overrides bucket file skills together regardless of directory. */
export const skillOverrideKind = (
  source: SkillSource,
): "file" | "agentBrowser" =>
  source === "agentBrowser" ? "agentBrowser" : "file";
