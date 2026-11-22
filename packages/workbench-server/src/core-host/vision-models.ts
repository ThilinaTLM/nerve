import {
  modelSelectionSchema,
  thinkingLevelSchema,
  type ModelSelection,
} from "@nervekit/contracts/models";
import { ExtensionError } from "@nervekit/extension-api";
import { explainImageWithModel } from "@nervekit/harness/models";
import { detectSupportedImageMimeType } from "@nervekit/tools/execution";
import type { ModelConfiguration } from "./model.adapter.js";

type Resolve = (
  selection: ModelSelection,
  configuration: ModelConfiguration,
) => Promise<{
  model: Parameters<typeof explainImageWithModel>[0]["model"];
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}>;

/**
 * The host side of `ctx.models.vision`: explains an image with the model an
 * extension's `model` setting (with its reasoning level) selects. The extension never
 * names the model itself.
 */
export type VisionHost = {
  /** Whether the selected model resolves with credentials and accepts images. */
  ready(settings: Record<string, unknown>): Promise<boolean>;
  explain(
    settings: Record<string, unknown>,
    request: {
      image: Uint8Array;
      prompt?: string;
      onDelta?: (update: { kind: "thinking" | "text"; delta: string }) => void;
      signal?: AbortSignal;
    },
  ): Promise<{ text: string; model: string }>;
};

export function createVisionHost(input: {
  resolve: Resolve;
  configuration: () => ModelConfiguration;
}): VisionHost {
  const resolve = async (settings: Record<string, unknown>) => {
    const selection = modelSelectionSchema.safeParse(settings.model);
    if (!selection.success) return undefined;
    const resolved = await input
      .resolve(selection.data, structuredClone(input.configuration()))
      .catch(() => undefined);
    if (!resolved || !(resolved.model.input ?? ["text"]).includes("image"))
      return undefined;
    return { selection: selection.data, resolved };
  };
  return {
    ready: async (settings) => (await resolve(settings)) !== undefined,
    async explain(settings, request) {
      const target = await resolve(settings);
      if (!target)
        throw new ExtensionError(
          "DENIED",
          "No usable image-capable model is selected.",
          {
            fix: "Ask the user to choose an image-capable model in the extension's settings (Settings → Extensions).",
          },
        );
      const data = Buffer.from(request.image);
      const mimeType = detectSupportedImageMimeType(data);
      if (!mimeType)
        throw new ExtensionError(
          "BAD_REQUEST",
          "Unsupported image format: only JPEG, PNG, GIF and WebP are accepted, detected from the file's contents.",
        );
      const thinking = thinkingLevelSchema.safeParse(
        (settings.model as { reasoningLevel?: unknown } | undefined)
          ?.reasoningLevel,
      );
      const text = await explainImageWithModel({
        model: target.resolved.model,
        auth: target.resolved,
        image: { type: "image", data: data.toString("base64"), mimeType },
        ...(request.prompt ? { prompt: request.prompt } : {}),
        thinkingLevel: thinking.success ? thinking.data : "off",
        ...(request.onDelta ? { onDelta: request.onDelta } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      return {
        text,
        model: `${target.selection.provider}/${target.selection.modelId}`,
      };
    },
  };
}
