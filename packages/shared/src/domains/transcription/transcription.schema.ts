import { z } from "zod";

export const AUDIO_TRANSCRIPTION_MAX_DURATION_MS = 8 * 60 * 1000;
export const AUDIO_TRANSCRIPTION_MAX_RETRIES = 3;

export const audioTranscriptionResponseSchema = z.object({
  text: z.string(),
});
export type AudioTranscriptionResponse = z.infer<
  typeof audioTranscriptionResponseSchema
>;
