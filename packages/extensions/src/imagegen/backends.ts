/**
 * Image generation backends. A backend is a member of the extension's
 * `backend` setting; adding one means a settings member, an entry in
 * `resolveRequest` and a host adapter that executes it.
 */

import type {
  ExtensionContext,
  ImageBackendRequest,
  ImagegenBackend,
} from "@nervekit/extension-api";

/** The resolved settings of the extension. */
export type ImagegenSettings = {
  backend: ImagegenBackend;
  model: string;
  quality: string;
  size: string;
  background: string;
};

export const IMAGEGEN_BACKENDS = [
  "openai-codex",
] as const satisfies readonly ImagegenBackend[];

export const OPENAI_CODEX_MODELS = [
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

export const DEFAULT_IMAGEGEN_SETTINGS: ImagegenSettings = {
  backend: "openai-codex",
  model: "gpt-image-2.5-flare",
  quality: "auto",
  size: "auto",
  background: "auto",
};

export function resolveImagegenSettings(raw: unknown): ImagegenSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const text = (key: keyof ImagegenSettings): string =>
    typeof value[key] === "string" && value[key]
      ? (value[key] as string)
      : DEFAULT_IMAGEGEN_SETTINGS[key];
  const backend = text("backend");
  return {
    backend: (IMAGEGEN_BACKENDS as readonly string[]).includes(backend)
      ? (backend as ImagegenBackend)
      : DEFAULT_IMAGEGEN_SETTINGS.backend,
    model: text("model"),
    quality: text("quality"),
    size: text("size"),
    background: text("background"),
  };
}

/** The extension's settings as `ctx` resolves them. */
export function imagegenSettingsOf(ctx: ExtensionContext): ImagegenSettings {
  return resolveImagegenSettings(
    Object.fromEntries(
      ["backend", "model", "quality", "size", "background"].map((key) => [
        key,
        ctx.settings.get(key),
      ]),
    ),
  );
}

/** `auto` or `<width>x<height>`: multiples of 16, long edge up to 3840, ratio up to 3:1, 0.65 to 8.3 megapixels. */
export function assertOpenAiCodexSize(size: unknown): string {
  const text = typeof size === "string" ? size.trim() : "";
  const match = /^(\d+)x(\d+)$/.exec(text);
  if (text === "auto") return text;
  const hint =
    'size must be "auto" or "<width>x<height>": multiples of 16, long edge up to 3840, ratio at most 3:1, 655360 to 8294400 pixels (for example "1536x1024").';
  if (!match) throw new Error(hint);
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
    throw new Error(hint);
  return text;
}

function oneOf(
  name: string,
  value: unknown,
  allowed: readonly string[],
): string {
  if (typeof value !== "string" || !allowed.includes(value))
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  return value;
}

/** Checks the call's own `size` and `backendOptions`, which do not depend on the configured settings (all backends today are openai-codex). */
export function assertCallOptions(call: {
  size?: string;
  backendOptions?: Record<string, unknown>;
}): void {
  if (call.size !== undefined) assertOpenAiCodexSize(call.size);
  const extra = call.backendOptions ?? {};
  const unknown = Object.keys(extra).filter(
    (key) => key !== "quality" && key !== "background",
  );
  if (unknown.length > 0)
    throw new Error(
      `backendOptions.${unknown[0]} is not an option of openai-codex; valid: quality, background.`,
    );
  if (extra.quality !== undefined)
    oneOf("backendOptions.quality", extra.quality, OPENAI_CODEX_QUALITIES);
  if (extra.background !== undefined)
    oneOf(
      "backendOptions.background",
      extra.background,
      OPENAI_CODEX_BACKGROUNDS,
    );
}

/** Applies the call's `size` and `backendOptions` over the configured settings; throws a teaching error for options the backend does not have. */
export function resolveRequest(
  settings: ImagegenSettings,
  call: {
    size?: string;
    backendOptions?: Record<string, unknown>;
    inputs: number;
  },
): ImageBackendRequest {
  if (settings.backend === "openai-codex") {
    const extra = call.backendOptions ?? {};
    const unknown = Object.keys(extra).filter(
      (key) => key !== "quality" && key !== "background",
    );
    if (unknown.length > 0)
      throw new Error(
        `backendOptions.${unknown[0]} is not an option of openai-codex; valid: quality, background.`,
      );
    if (call.inputs > 0)
      throw new Error(
        "The openai-codex backend cannot take reference images (inputs). Describe the image in the prompt, or ask the user to select a backend that supports inputs in Settings → Extensions → Image generation.",
      );
    return {
      backend: "openai-codex",
      model: oneOf("model", settings.model, OPENAI_CODEX_MODELS),
      quality: oneOf(
        "backendOptions.quality",
        extra.quality ?? settings.quality,
        OPENAI_CODEX_QUALITIES,
      ),
      size: assertOpenAiCodexSize(call.size ?? settings.size),
      background: oneOf(
        "backendOptions.background",
        extra.background ?? settings.background,
        OPENAI_CODEX_BACKGROUNDS,
      ),
    };
  }
  throw new Error(`Unknown image backend: ${String(settings.backend)}.`);
}

/** One line for `sdk.describe`: the configured backend, its defaults and the per-call options it accepts. */
export function describeBackend(settings: ImagegenSettings): string {
  if (settings.backend === "openai-codex")
    return `Configured backend: openai-codex, model ${settings.model}, defaults quality ${settings.quality}, size ${settings.size}, background ${settings.background}. backendOptions: { quality?: ${OPENAI_CODEX_QUALITIES.map((value) => `"${value}"`).join(" | ")}; background?: ${OPENAI_CODEX_BACKGROUNDS.map((value) => `"${value}"`).join(" | ")} }. No reference images (inputs).`;
  return `Configured backend: ${String(settings.backend)}.`;
}
