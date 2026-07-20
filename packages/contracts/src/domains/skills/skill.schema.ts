import { z } from "zod";

export const availableSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  filePath: z.string().min(1),
});
export type AvailableSkill = z.infer<typeof availableSkillSchema>;

export const availableSkillsResponseSchema = z.object({
  globalSkills: z.array(availableSkillSchema),
  projectSkills: z.array(availableSkillSchema),
});
export type AvailableSkillsResponse = z.infer<
  typeof availableSkillsResponseSchema
>;
