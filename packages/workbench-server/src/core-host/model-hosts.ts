import type { ImageModelSelection } from "@nervekit/extension-api";
import type {
  ImageGenerateRequest,
  ImageGenerateResponse,
} from "@nervekit/extension-api/host";
import type { AgentConfigurationService } from "../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import type { ImageModelListing } from "../domains/image-generation/image-generation.service.js";
import type { ModelConfiguration } from "./model.adapter.js";
import { createTextHost, type TextHost } from "./text-models.js";
import { createVisionHost, type VisionHost } from "./vision-models.js";

/** Image generation behind `ctx.models.image`. */
export type ImageHost = {
  generate(request: ImageGenerateRequest): Promise<ImageGenerateResponse>;
  ready(model: ImageModelSelection): Promise<boolean>;
  listModels(): Promise<ImageModelListing[]>;
};

/** The hosts behind `ctx.models`; a member is absent where the host has none. */
export type ModelHosts = {
  vision?: VisionHost;
  text?: TextHost;
  images?: ImageHost;
};

/** The vision and text hosts, plus the given image host. */
export function createModelHosts(input: {
  models: Parameters<typeof createTextHost>[0]["models"];
  configuration: () => ModelConfiguration;
  agents: () => Pick<AgentConfigurationService, "captureDefaults">;
  images?: ImageHost;
}): ModelHosts {
  return {
    vision: createVisionHost({
      resolve: async (selection, configuration) =>
        await input.models.resolve(selection, configuration),
      configuration: input.configuration,
    }),
    text: createTextHost(input),
    ...(input.images ? { images: input.images } : {}),
  };
}
