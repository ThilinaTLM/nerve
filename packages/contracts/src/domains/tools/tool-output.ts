import { z } from "zod";
export const toolOutputStreamSchema = z.enum([
  "stdout",
  "stderr",
  "combined",
  "thinking",
  "text",
]);
export type ToolOutputStream = z.infer<typeof toolOutputStreamSchema>;
