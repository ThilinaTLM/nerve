/**
 * What the imagegen extension knows about the OpenAI Codex image backend: the value lists of its
 * setting controls, the call checks it can make before an approval, and the describe line. The
 * host owns the backends and validates every request again.
 */

import type {
  ExtensionHookContext,
  ImageModelSelection,
} from "@nervekit/extension-api";

/** The resolved settings of the extension. */
export type ImagegenSettings = {
  /** The `imageModel` setting; undefined until the user picks one. */
  model: ImageModelSelection | undefined;
  quality: string;
  size: string;
  background: string;
};

/** The models of the openai-codex backend before settings version 2 (its migration's default). */
export const OPENAI_CODEX_LEGACY_MODEL = "gpt-image-2.5-flare";

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

const DEFAULTS = { quality: "auto", size: "auto", background: "auto" };

function selectionOf(value: unknown): ImageModelSelection | undefined {
  const record =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  return record &&
    typeof record.provider === "string" &&
    typeof record.modelId === "string"
    ? { provider: record.provider, modelId: record.modelId }
    : undefined;
}

/** The extension's settings as `ctx` resolves them. */
export function imagegenSettingsOf(
  ctx: Pick<ExtensionHookContext, "settings">,
): ImagegenSettings {
  const text = (key: keyof typeof DEFAULTS): string => {
    const value = ctx.settings.get(key);
    return typeof value === "string" && value ? value : DEFAULTS[key];
  };
  return {
    model: selectionOf(ctx.settings.get("model")),
    quality: text("quality"),
    size: text("size"),
    background: text("background"),
  };
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

/** Checks the call's own `size` and `backendOptions` before any approval (all backends today are openai-codex; the host checks again). */
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

/** One line for `sdk.describe`: the selected model, its defaults and the per-call options. */
export function describeBackend(settings: ImagegenSettings): string {
  if (!settings.model) return "No image model is selected in the settings.";
  return `Configured model: ${settings.model.provider}/${settings.model.modelId}, defaults quality ${settings.quality}, size ${settings.size}, background ${settings.background}. backendOptions: { quality?: ${OPENAI_CODEX_QUALITIES.map((value) => `"${value}"`).join(" | ")}; background?: ${OPENAI_CODEX_BACKGROUNDS.map((value) => `"${value}"`).join(" | ")} }.`;
}
