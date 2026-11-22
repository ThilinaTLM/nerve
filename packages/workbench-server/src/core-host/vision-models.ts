import {
  thinkingLevelSchema,
  type ModelSelection as ResolvableModel,
} from "@nervekit/contracts/models";
import { ExtensionError, type ModelSelection } from "@nervekit/extension-api";
import { explainImageWithModel } from "@nervekit/harness/models";
import { detectSupportedImageMimeType } from "@nervekit/tools/execution";
import type { ModelConfiguration } from "./model.adapter.js";

type Resolve = (
  selection: ResolvableModel,
  configuration: ModelConfiguration,
) => Promise<{
  model: Parameters<typeof explainImageWithModel>[0]["model"];
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}>;

/**
 * The host side of `ctx.models.vision`: explains an image with the model of the
 * request (and its reasoning level). The extension runtime has already checked the
 * selection; this host reads no settings.
 */
export type VisionHost = {
  /** Whether the model resolves with credentials and accepts images. */
  ready(model: ModelSelection): Promise<boolean>;
  explain(request: {
    model: ModelSelection;
    image: Uint8Array;
    prompt?: string | undefined;
    onDelta?:
      | ((update: { kind: "thinking" | "text"; delta: string }) => void)
      | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<{ text: string; model: string }>;
};

export function createVisionHost(input: {
  resolve: Resolve;
  configuration: () => ModelConfiguration;
}): VisionHost {
  const resolve = async (selection: ModelSelection) => {
    const resolved = await input
      .resolve(selection, structuredClone(input.configuration()))
      .catch(() => undefined);
    if (!resolved || !(resolved.model.input ?? ["text"]).includes("image"))
      return undefined;
    return resolved;
  };
  return {
    ready: async (model) => (await resolve(model)) !== undefined,
    async explain(request) {
      const resolved = await resolve(request.model);
      if (!resolved)
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
        request.model.reasoningLevel,
      );
      const text = await explainImageWithModel({
        model: resolved.model,
        auth: resolved,
        image: { type: "image", data: data.toString("base64"), mimeType },
        ...(request.prompt ? { prompt: request.prompt } : {}),
        thinkingLevel: thinking.success ? thinking.data : "off",
        ...(request.onDelta ? { onDelta: request.onDelta } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      return {
        text,
        model: `${request.model.provider}/${request.model.modelId}`,
      };
    },
  };
}
