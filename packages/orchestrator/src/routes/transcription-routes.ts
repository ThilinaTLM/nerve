import { Hono } from "hono";
import type { OrchestratorState } from "../app/orchestrator-state.js";
import { transcribeAudioWithChatGptSubscription } from "../domains/transcription/transcription.service.js";
import { HttpError } from "../http/errors.js";
import { routeHandler } from "../http/responses.js";

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
    typeof value === "object" &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function",
  );
}

function parseDurationMs(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new HttpError(
      400,
      "INVALID_DURATION",
      "durationMs must be a positive number of milliseconds.",
    );
  }
  return parsed;
}

export function createTranscriptionRoutes(state: OrchestratorState): Hono {
  const app = new Hono();

  app.post(
    "/transcription/audio",
    routeHandler(async (c) => {
      const form = await c.req.formData();
      const uploaded = form.get("file");
      if (!isUploadedFile(uploaded)) {
        throw new HttpError(
          400,
          "AUDIO_FILE_REQUIRED",
          "Audio file is required.",
        );
      }

      const data = new Uint8Array(await uploaded.arrayBuffer());
      const result = await transcribeAudioWithChatGptSubscription(state.auth, {
        data,
        mimeType: uploaded.type,
        durationMs: parseDurationMs(form.get("durationMs")),
      });
      return c.json(result);
    }),
  );

  return app;
}
