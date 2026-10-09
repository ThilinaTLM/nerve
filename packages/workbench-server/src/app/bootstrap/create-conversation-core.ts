import { mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ConversationCore,
  openCoreStorage,
  createDelegationTools,
  createAsyncBashTools,
} from "@nervekit/conversation-core";
import {
  resolvePythonRuntime,
  type ToolExecutionContext,
} from "@nervekit/tools/execution";
import { explainImageWithModel } from "@nervekit/harness/models";
import { createModelPort } from "../../core-host/model.adapter.js";
import { createPermissionPort } from "../../core-host/permission.adapter.js";
import { CoreProcessHost } from "../../core-host/process.adapter.js";
import { createToolHostPort } from "../../core-host/tool-host.adapter.js";
import { createTurnResourcesPort } from "../../core-host/turn-resources.adapter.js";
import type { RuntimeDeps } from "./create-runtime-services.js";
import { resolveProjectSettings } from "../../infrastructure/configuration/index.js";
import { ImageGenerationService } from "../../domains/image-generation/image-generation.service.js";
import { OpenAiCodexImageGenerationProvider } from "../../domains/image-generation/providers/openai-codex-image-generation.provider.js";

export function createConversationCore(deps: RuntimeDeps) {
  const dataDir = deps.storage.paths.dataPath;
  mkdirSync(dataDir, { recursive: true });
  const storage = openCoreStorage(join(dataDir, "core.sqlite"));
  const models = createModelPort(deps.auth, deps.providerCatalog, (name) =>
    deps.secrets.get(name),
  );
  const processes = new CoreProcessHost(
    deps.storage.settings.runtime.shellPath ?? "/bin/bash",
  );
  const imageGeneration = new ImageGenerationService([
    new OpenAiCodexImageGenerationProvider(deps.auth),
  ]);
  const tools = createToolHostPort(
    processes,
    async (cwd): Promise<ToolExecutionContext> => {
      const settings = await resolveProjectSettings(deps.storage, cwd);
      const atlassian = (provider: "jira" | "confluence") =>
        settings.providers.atlassianProfiles.find(
          (profile) => profile.id === settings.tools[provider].profileId,
        );
      const credentialProvider = (provider: string) =>
        provider === "jira" || provider === "confluence"
          ? atlassian(provider)
            ? `atlassian:${atlassian(provider)!.id}`
            : undefined
          : provider === "tavily"
            ? settings.tools.web.tavilyProfileId
              ? `tavily:${settings.tools.web.tavilyProfileId}`
              : undefined
            : provider;
      const python = await resolvePythonRuntime({
        cwd,
        manualPath: settings.runtime.pythonExecutablePath,
      });
      return {
        cwd,
        shellPath: settings.runtime.shellPath,
        pythonRuntime: python.available ? python : undefined,
        kroki: settings.tools.kroki,
        getApiKey: (provider) => {
          const key = credentialProvider(provider);
          return key ? deps.auth.getApiKey(key) : Promise.resolve(undefined);
        },
        getProviderConfig: async (provider) => {
          if (provider !== "jira" && provider !== "confluence")
            return undefined;
          const profile = atlassian(provider);
          return {
            ...profile,
            enabled: settings.tools[provider].enabled && Boolean(profile),
          };
        },
        generateImage: (request) =>
          imageGeneration.generate(request, settings.tools.imageGeneration),
        explainImage: async (request) => {
          const selection = settings.tools.imageExplanation.model;
          if (!selection)
            throw new Error(
              "Choose an image explanation model in Settings → Tools.",
            );
          const resolved = await models.resolve(selection);
          const explanation = await explainImageWithModel({
            model: resolved.model,
            auth: resolved,
            image: {
              type: "image",
              data: Buffer.from(request.data).toString("base64"),
              mimeType: request.mimeType,
            },
            prompt: request.prompt,
            thinkingLevel: settings.tools.imageExplanation.thinkingLevel,
            signal: request.signal,
          });
          return { explanation, model: selection };
        },
      };
    },
    async (cwd) => {
      const settings = await resolveProjectSettings(deps.storage, cwd);
      return settings.tools.bash.autoPromotion.enabled
        ? settings.tools.bash.autoPromotion.afterMs
        : null;
    },
  );
  const core = new ConversationCore({
    storage,
    dataDir,
    models,
    processes,
    permissions: createPermissionPort(deps.storage.paths.home, storage),
    toolHost: tools.port,
    turnResources: createTurnResourcesPort({
      home: deps.storage.paths.home,
      tools: tools.definitions,
      skills: [...deps.nerveSkills.skills, ...deps.agentBrowserSkills.skills],
    }),
    defaultConfig: async (projectId) => {
      const project = storage.projects.get(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      const settings = await resolveProjectSettings(
        deps.storage,
        project.directory,
      );
      const model = settings.defaultModel ?? settings.lastAgentSelection.model;
      if (!model)
        throw new Error(
          "Choose a default model before creating a conversation.",
        );
      return {
        model,
        reasoningLevel: settings.defaultThinkingLevel,
        systemPrompt: null,
        permissionRuleSetId: settings.defaultPermissionRuleSetId ?? "baseline",
        mode: settings.lastAgentSelection.mode,
        enabledTools: null,
        enabledSkills: null,
        workingDirectory: project.directory,
      };
    },
    readPlan: ({ path, signal }) =>
      readFile(path, { encoding: "utf8", signal }),
  });
  for (const handler of [
    ...createDelegationTools(core),
    ...createAsyncBashTools(core),
  ])
    core.registerCoreTool(handler);
  return { core, storage };
}
