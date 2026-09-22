import type {
  ImageGenerationToolSettings,
  OpenAiCodexImageGenerationSettings,
} from "@nervekit/contracts/settings";
import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/tools/execution";
import { ApplicationError } from "../../../core/application-error.js";
import {
  chatGptAccountIdFromAccessToken,
  type AuthManager,
} from "../../auth/index.js";
import type { ImageGenerationProviderAdapter } from "../image-generation.provider.js";

const CHATGPT_IMAGE_GENERATION_URL =
  "https://chatgpt.com/backend-api/codex/images/generations";
const OPENAI_CODEX_PROVIDER = "openai-codex";
const MAX_ERROR_BODY_CHARS = 2_000;

type ChatGptImageResponse = {
  data?: Array<{ b64_json?: unknown; revised_prompt?: unknown }>;
};

export class OpenAiCodexImageGenerationProvider implements ImageGenerationProviderAdapter {
  readonly id = OPENAI_CODEX_PROVIDER;

  constructor(
    private readonly auth: AuthManager,
    private readonly onUsed?: () => void,
  ) {}

  async isAvailable(): Promise<boolean> {
    return (
      (await this.auth.getCredential(OPENAI_CODEX_PROVIDER))?.type === "oauth"
    );
  }

  async generate(
    request: ImageGenerateRequest,
    settings: ImageGenerationToolSettings,
  ): Promise<ImageGenerateResponse> {
    if (settings.provider !== OPENAI_CODEX_PROVIDER) {
      throw new ApplicationError(
        400,
        "IMAGE_GENERATION_PROVIDER_SETTINGS_INVALID",
        "OpenAI Codex image generation received incompatible settings.",
      );
    }
    this.onUsed?.();
    return generateWithOpenAiCodex(this.auth, request, settings);
  }
}

async function generateWithOpenAiCodex(
  auth: AuthManager,
  request: ImageGenerateRequest,
  settings: OpenAiCodexImageGenerationSettings,
): Promise<ImageGenerateResponse> {
  const credential = await auth.getCredential(OPENAI_CODEX_PROVIDER);
  if (credential?.type !== "oauth") {
    throw new ApplicationError(
      401,
      "CHATGPT_SUBSCRIPTION_AUTH_REQUIRED",
      "OpenAI Codex image generation requires an OAuth connection in Settings.",
    );
  }

  // getApiKey delegates refresh to the provider model manager before returning.
  const accessToken = await auth.getApiKey(OPENAI_CODEX_PROVIDER);
  if (!accessToken) {
    throw new ApplicationError(
      401,
      "CHATGPT_SUBSCRIPTION_AUTH_REQUIRED",
      "OpenAI Codex image generation requires an OAuth connection in Settings.",
    );
  }
  const accountId = chatGptAccountIdFromAccessToken(accessToken);
  if (!accountId) {
    throw new ApplicationError(
      401,
      "CHATGPT_ACCOUNT_ID_MISSING",
      "Could not determine the ChatGPT account id. Reconnect OpenAI Codex in Settings.",
    );
  }

  const response = await fetch(CHATGPT_IMAGE_GENERATION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "ChatGPT-Account-ID": accountId,
      originator: "codex_cli_rs",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: settings.model,
      prompt: request.prompt,
      quality: settings.options.quality,
      size: settings.options.size,
      background: settings.options.background,
      n: 1,
    }),
    signal: request.signal,
  });
  const body = await response.text();
  if (!response.ok) {
    throw new ApplicationError(
      response.status,
      response.status === 429
        ? "CHATGPT_IMAGE_RATE_LIMITED"
        : response.status === 401
          ? "CHATGPT_SUBSCRIPTION_AUTH_REJECTED"
          : "CHATGPT_IMAGE_GENERATION_FAILED",
      responseErrorMessage(response.status, body),
    );
  }

  let parsed: ChatGptImageResponse;
  try {
    parsed = JSON.parse(body) as ChatGptImageResponse;
  } catch {
    throw new ApplicationError(
      502,
      "CHATGPT_IMAGE_RESPONSE_INVALID",
      "ChatGPT returned an invalid image-generation response.",
    );
  }
  const images = (parsed.data ?? []).flatMap((item) => {
    if (typeof item.b64_json !== "string" || item.b64_json.length === 0) {
      return [];
    }
    const data = Buffer.from(item.b64_json, "base64");
    if (data.byteLength === 0) return [];
    return [
      {
        data: new Uint8Array(data),
        ...(typeof item.revised_prompt === "string" && item.revised_prompt
          ? { revisedPrompt: item.revised_prompt }
          : {}),
      },
    ];
  });
  if (images.length === 0) {
    throw new ApplicationError(
      502,
      "CHATGPT_IMAGE_RESPONSE_EMPTY",
      "ChatGPT returned no generated image data.",
    );
  }
  return { provider: OPENAI_CODEX_PROVIDER, model: settings.model, images };
}

function responseErrorMessage(status: number, body: string): string {
  let remoteMessage: string | undefined;
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown };
      detail?: { message?: unknown };
    };
    const candidate = parsed.error?.message ?? parsed.detail?.message;
    if (typeof candidate === "string") remoteMessage = candidate.trim();
  } catch {
    remoteMessage = body.trim().slice(0, MAX_ERROR_BODY_CHARS);
  }
  if (status === 401) {
    return "ChatGPT rejected the OpenAI Codex OAuth session. Reconnect OpenAI Codex in Settings.";
  }
  if (status === 429) {
    return (
      remoteMessage || "ChatGPT image generation is currently rate limited."
    );
  }
  return remoteMessage
    ? `ChatGPT image generation failed (${status}): ${remoteMessage}`
    : `ChatGPT image generation failed with HTTP ${status}.`;
}
