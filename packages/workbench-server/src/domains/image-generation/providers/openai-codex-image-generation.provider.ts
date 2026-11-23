import { ExtensionError } from "@nervekit/extension-api";
import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/extension-api/host";
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

export const OPENAI_CODEX_IMAGE_MODELS = [
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
] as const;
export const OPENAI_CODEX_QUALITIES = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export const OPENAI_CODEX_BACKGROUNDS = [
  "auto",
  "opaque",
  "transparent",
] as const;

type CodexImageOptions = {
  model: string;
  quality: string;
  size: string;
  background: string;
};

function oneOf(
  name: string,
  value: unknown,
  allowed: readonly string[],
): string {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new ExtensionError(
      "BAD_REQUEST",
      `${name} must be one of: ${allowed.join(", ")}.`,
    );
  return value;
}

/** `auto` or `<width>x<height>`: multiples of 16, long edge up to 3840, ratio up to 3:1, 0.65 to 8.3 megapixels. */
export function assertOpenAiCodexSize(size: unknown): string {
  const text = typeof size === "string" ? size.trim() : "";
  if (text === "auto") return text;
  const match = /^(\d+)x(\d+)$/.exec(text);
  const hint =
    'size must be "auto" or "<width>x<height>": multiples of 16, long edge up to 3840, ratio at most 3:1, 655360 to 8294400 pixels (for example "1536x1024").';
  if (!match) throw new ExtensionError("BAD_REQUEST", hint);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (
    !width ||
    !height ||
    width % 16 !== 0 ||
    height % 16 !== 0 ||
    Math.max(width, height) > 3840 ||
    Math.max(width, height) / Math.min(width, height) > 3 ||
    pixels < 655_360 ||
    pixels > 8_294_400
  )
    throw new ExtensionError("BAD_REQUEST", hint);
  return text;
}

/** Validates a request for the codex backend; absent options default to `auto`. */
export function resolveOpenAiCodexOptions(
  request: ImageGenerateRequest,
): CodexImageOptions {
  const model = oneOf(
    "model",
    request.model.modelId,
    OPENAI_CODEX_IMAGE_MODELS,
  );
  if (request.inputs.length > 0)
    throw new ExtensionError(
      "BAD_REQUEST",
      "The openai-codex backend cannot take reference images (inputs). Describe the image in the prompt instead.",
    );
  const options = request.options;
  return {
    model,
    quality: oneOf(
      "quality",
      options.quality ?? "auto",
      OPENAI_CODEX_QUALITIES,
    ),
    size: assertOpenAiCodexSize(options.size ?? "auto"),
    background: oneOf(
      "background",
      options.background ?? "auto",
      OPENAI_CODEX_BACKGROUNDS,
    ),
  };
}

type ChatGptImageResponse = {
  data?: Array<{ b64_json?: unknown; revised_prompt?: unknown }>;
};

export class OpenAiCodexImageGenerationProvider implements ImageGenerationProviderAdapter {
  readonly id = OPENAI_CODEX_PROVIDER;

  constructor(
    private readonly auth: AuthManager,
    private readonly onUsed?: () => void,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  models() {
    return [
      { modelId: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" },
      { modelId: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst" },
    ];
  }

  async ready(): Promise<boolean> {
    return (
      (await this.auth.getCredential(OPENAI_CODEX_PROVIDER))?.type === "oauth"
    );
  }

  async generate(
    request: ImageGenerateRequest,
  ): Promise<ImageGenerateResponse> {
    const options = resolveOpenAiCodexOptions(request);
    this.onUsed?.();
    return generateWithOpenAiCodex(this.auth, request, options, this.fetchImpl);
  }
}

async function generateWithOpenAiCodex(
  auth: AuthManager,
  request: ImageGenerateRequest,
  settings: CodexImageOptions,
  fetchImpl: typeof fetch,
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

  const response = await fetchImpl(CHATGPT_IMAGE_GENERATION_URL, {
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
      quality: settings.quality,
      size: settings.size,
      background: settings.background,
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
  return {
    model: `${OPENAI_CODEX_PROVIDER}/${settings.model}`,
    images,
  };
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
