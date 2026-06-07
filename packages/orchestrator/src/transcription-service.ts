import { randomUUID } from "node:crypto";
import type { AudioTranscriptionResponse } from "@nerve/shared";
import {
  AUDIO_TRANSCRIPTION_MAX_DURATION_MS,
  audioTranscriptionResponseSchema,
} from "@nerve/shared";
import type { AuthManager } from "./auth.js";
import { HttpError } from "./http/errors.js";

const CHATGPT_TRANSCRIBE_URL = "https://chatgpt.com/backend-api/transcribe";
const OPENAI_CODEX_PROVIDER = "openai-codex";
const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type NormalizedAudioMime = {
  mimeType: string;
  extension: string;
};

export type AudioTranscriptionInput = {
  data: Uint8Array;
  mimeType: string;
  durationMs?: number;
};

export function normalizeAudioMimeType(
  mimeType: string | undefined,
): NormalizedAudioMime | undefined {
  const normalized = (mimeType ?? "").split(";")[0]?.trim().toLowerCase();
  switch (normalized) {
    case "audio/webm":
      return { mimeType: "audio/webm", extension: "webm" };
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return { mimeType: "audio/mp4", extension: "mp4" };
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
      return { mimeType: "audio/wav", extension: "wav" };
    case "audio/mpeg":
    case "audio/x-mpeg":
      return { mimeType: "audio/mpeg", extension: "mp3" };
    case "audio/mp3":
      return { mimeType: "audio/mp3", extension: "mp3" };
    case "audio/mpga":
      return { mimeType: "audio/mpga", extension: "mpga" };
    case "audio/ogg":
    case "audio/oga":
      return { mimeType: "audio/ogg", extension: "ogg" };
    case "audio/flac":
    case "audio/x-flac":
      return { mimeType: "audio/flac", extension: "flac" };
    default:
      return undefined;
  }
}

export function chatGptAccountIdFromAccessToken(
  accessToken: string,
): string | undefined {
  const payload = accessToken.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as {
      "https://api.openai.com/auth"?: { chatgpt_account_id?: unknown };
    };
    const accountId = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
    return typeof accountId === "string" && accountId ? accountId : undefined;
  } catch {
    return undefined;
  }
}

function estimateDurationMs(sizeBytes: number): number {
  return Math.max(1, Math.round((sizeBytes * 1000) / 50_000));
}

export async function transcribeAudioWithChatGptSubscription(
  auth: AuthManager,
  input: AudioTranscriptionInput,
): Promise<AudioTranscriptionResponse> {
  if (input.data.byteLength === 0) {
    throw new HttpError(400, "EMPTY_AUDIO", "Audio upload is empty.");
  }
  if (input.data.byteLength > MAX_AUDIO_BYTES) {
    throw new HttpError(
      413,
      "AUDIO_TOO_LARGE",
      "Audio upload is larger than the 25 MB transcription limit.",
    );
  }

  const normalized = normalizeAudioMimeType(input.mimeType);
  if (!normalized) {
    throw new HttpError(
      400,
      "UNSUPPORTED_AUDIO_TYPE",
      `Unsupported audio MIME type: ${input.mimeType || "unknown"}.`,
    );
  }

  const credential = await auth.getCredential(OPENAI_CODEX_PROVIDER);
  if (credential?.type !== "oauth") {
    throw new HttpError(
      401,
      "CHATGPT_SUBSCRIPTION_AUTH_REQUIRED",
      "ChatGPT subscription auth is not configured. Configure the OpenAI Codex OAuth provider first.",
    );
  }

  const accessToken = await auth.getApiKey(OPENAI_CODEX_PROVIDER);
  if (!accessToken) {
    throw new HttpError(
      401,
      "CHATGPT_SUBSCRIPTION_AUTH_REQUIRED",
      "ChatGPT subscription auth is not configured. Configure the OpenAI Codex OAuth provider first.",
    );
  }

  const accountId = chatGptAccountIdFromAccessToken(accessToken);
  if (!accountId) {
    throw new HttpError(
      401,
      "CHATGPT_ACCOUNT_ID_MISSING",
      "Could not determine the ChatGPT account id from the stored OAuth access token. Reconnect OpenAI Codex auth.",
    );
  }

  const durationMs =
    input.durationMs ?? estimateDurationMs(input.data.byteLength);
  if (durationMs > AUDIO_TRANSCRIPTION_MAX_DURATION_MS) {
    throw new HttpError(
      413,
      "AUDIO_DURATION_TOO_LONG",
      "Audio recordings are limited to 8 minutes.",
    );
  }

  const audioBuffer = new ArrayBuffer(input.data.byteLength);
  new Uint8Array(audioBuffer).set(input.data);
  const file = new Blob([audioBuffer], { type: normalized.mimeType });
  const form = new FormData();
  form.append("file", file, `whisper.${normalized.extension}`);
  form.append("duration_ms", String(Math.max(1, Math.round(durationMs))));
  form.append("model", DEFAULT_TRANSCRIBE_MODEL);

  const response = await fetch(CHATGPT_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
      Accept: "*/*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://chatgpt.com",
      Referer: "https://chatgpt.com/",
      "oai-language": "en-US",
      "oai-device-id": randomUUID(),
      "chatgpt-account-id": accountId,
      "sec-ch-ua": '"Chromium";v="131", "Not(A:Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Linux"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    },
    body: form,
  });

  if (response.status === 401) {
    throw new HttpError(
      401,
      "CHATGPT_SUBSCRIPTION_AUTH_REJECTED",
      "ChatGPT rejected the stored OAuth token. Reconnect OpenAI Codex auth.",
    );
  }
  if (response.status === 429) {
    throw new HttpError(
      429,
      "TRANSCRIPTION_RATE_LIMITED",
      "ChatGPT transcription is rate limited. Try again shortly.",
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new HttpError(
      response.status,
      "TRANSCRIPTION_FAILED",
      `ChatGPT transcription failed (${response.status}): ${body || response.statusText}`,
    );
  }

  const parsed = audioTranscriptionResponseSchema.parse(await response.json());
  const text = parsed.text.trim();
  if (!text) {
    throw new HttpError(
      502,
      "EMPTY_TRANSCRIPTION",
      "ChatGPT returned an empty transcription.",
    );
  }
  return { text };
}
