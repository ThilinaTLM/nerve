import { z } from "zod";

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  directory: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof projectSchema>;
