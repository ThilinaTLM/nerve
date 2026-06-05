import { z } from "zod";

export const audioTranscriptionResponseSchema = z.object({
  text: z.string(),
});
export type AudioTranscriptionResponse = z.infer<
  typeof audioTranscriptionResponseSchema
>;
