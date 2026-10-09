import { z } from "zod";
export const conversationLiveToolOutputStreamSchema = z.enum([
  "stdout",
  "stderr",
  "combined",
  "thinking",
  "text",
]);
export type ConversationLiveToolOutputStream = z.infer<
  typeof conversationLiveToolOutputStreamSchema
>;
