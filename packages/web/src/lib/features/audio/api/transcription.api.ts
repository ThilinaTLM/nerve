import type { AudioTranscriptionResponse } from "@nervekit/shared";
import {
  ApiRequestError,
  parseApiErrorBody,
} from "@nervekit/ui/core/api/client";

function extensionForAudioType(type: string): string {
  const normalized = type.split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return "wav";
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "mp4";
    case "audio/mpeg":
    case "audio/mp3":
    case "audio/x-mpeg":
      return "mp3";
    case "audio/mpga":
      return "mpga";
    case "audio/flac":
    case "audio/x-flac":
      return "flac";
    case "audio/ogg":
    case "audio/oga":
      return "ogg";
    default:
      return "webm";
  }
}

type TranscribeAudioOptions = {
  signal?: AbortSignal;
};

async function parseTranscriptionResponse(
  response: Response,
): Promise<AudioTranscriptionResponse> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const apiError = parseApiErrorBody(body);
    throw new ApiRequestError(
      response.status,
      apiError.code,
      apiError.message ||
        body ||
        response.statusText ||
        "Transcription failed.",
    );
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const body = await response.text();
    throw new ApiRequestError(
      response.status,
      undefined,
      `Expected JSON response from transcription API, received ${contentType || "unknown content type"}. ${body.slice(0, 80)}`,
    );
  }
  return (await response.json()) as AudioTranscriptionResponse;
}

export async function transcribeAudio(
  audio: Blob,
  durationMs: number,
  options: TranscribeAudioOptions = {},
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    audio,
    `composer-recording.${extensionForAudioType(audio.type)}`,
  );
  form.append("durationMs", String(Math.max(1, Math.round(durationMs))));
  return (
    await parseTranscriptionResponse(
      await fetch("/api/transcription/audio", {
        method: "POST",
        credentials: "same-origin",
        body: form,
        signal: options.signal,
      }),
    )
  ).text;
}
