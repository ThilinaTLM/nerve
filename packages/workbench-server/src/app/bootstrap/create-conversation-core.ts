import { mkdirSync } from "node:fs";
import { createId } from "@nervekit/contracts";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import {
  LaunchTool,
  type LaunchToolOptions,
} from "../../core-host/launch-tool.js";
import { readFile } from "node:fs/promises";
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
import { ConversationHarnessSettings } from "../../core-host/conversation-harness.service.js";
import { createProfileModelInfo } from "../../core-host/profile-model-availability.js";
import { profileToolAvailability } from "../../core-host/profile-tool-availability.js";
import { createProfileAvailability } from "../../core-host/subagent-profile-availability.js";
import { listAvailableSkills } from "../../core-host/resource-loader.js";
import { userCapabilitySelection } from "../../core-host/user-capability-selection.js";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import { createSubagentHost } from "../../core-host/subagent-host.js";
import type { SubagentProfileService } from "../../domains/subagents/subagent-profile.service.js";
import { CapabilityService } from "../../core-host/capability.service.js";
import { createModelPort } from "../../core-host/model.adapter.js";
import { createPermissionPort } from "../../core-host/permission.adapter.js";
import { CoreProcessHost } from "../../core-host/process.adapter.js";
import { createToolHostPort } from "../../core-host/tool-host.adapter.js";
import { createTurnResourcesPort } from "../../core-host/turn-resources.adapter.js";
import type { RuntimeDeps } from "./create-runtime-services.js";
import { resolveProjectSettings } from "../../infrastructure/configuration/index.js";
import { ImageGenerationService } from "../../domains/image-generation/image-generation.service.js";
import { OpenAiCodexImageGenerationProvider } from "../../domains/image-generation/providers/openai-codex-image-generation.provider.js";

export function createConversationCore(
  deps: RuntimeDeps,
  launchServices: Pick<LaunchToolOptions, "launches" | "definitions">,
  /** Lazy: the profile service needs the core's trust registry. */
  subagentProfiles: () => SubagentProfileService,
) {
  const dataDir = deps.storage.paths.dataPath;
  mkdirSync(dataDir, { recursive: true });
  const storage = openCoreStorage(deps.storage.paths.sqlitePath);
  const models = createModelPort(deps.auth, deps.providerCatalog, (name) =>
    deps.secrets.get(name),
  );
  const processes = new CoreProcessHost(
    deps.storage.settings.runtime.shellPath ?? "/bin/bash",
  );
  const imageGeneration = new ImageGenerationService([
    new OpenAiCodexImageGenerationProvider(deps.auth),
  ]);
  const launchTool = new LaunchTool({
    ...launchServices,
    project: (conversationId) => {
      const projectId = core.getSnapshot(conversationId).conversation.projectId;
      const project = core.projects.get(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      return project;
    },
    notify: (conversationId, launch, text) => {
      core.inputs.enqueueNotice({
        conversationId,
        inputId: createId("input"),
        subtype: "notification",
        producer: launch.id,
        text,
        wakeWhenIdle: true,
      });
    },
  });
  deps.events.subscribeNotify((event) => {
    if (!event.type.startsWith("launch.")) return;
    const launch = (event.data as { launch?: LaunchRecord }).launch;
    if (launch)
      void launchTool.changed(event.type, launch).catch((error) => {
        void deps.logger.warn("Launch completion notice failed", { error });
      });
  });
  const tools = createToolHostPort(
    processes,
    async (cwd, conversationId): Promise<ToolExecutionContext> => {
      const projectId = core.getSnapshot(conversationId).conversation.projectId;
      const settings = await capabilities.settings(projectId, conversationId);
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
      return settings.tools.bash;
    },
    launchTool,
  );
  const core: ConversationCore = new ConversationCore({
    storage,
    dataDir,
    models,
    processes,
    permissions: createPermissionPort(
      deps.storage.paths.home,
      storage,
      async (cwd) =>
        (await resolveProjectSettings(deps.storage, cwd)).tools.bash,
    ),
    toolHost: tools.port,
    turnResources: createTurnResourcesPort({
      home: deps.storage.paths.home,
      tools: tools.definitions,
      skills: deps.nerveSkills.skills,
      agentBrowserSkills: deps.agentBrowserSkills.skills,
      hasExistingSubagents: (id) =>
        (storage.conversations.getSummary(id)?.childCount ?? 0) > 0,
      get capabilities(): CapabilityService {
        return capabilities;
      },
      get subagentProfiles(): SubagentProfileService {
        return subagentProfiles();
      },
    }),
    compactionSettings: (id) => harness.compactionSettings(id),
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
        instructions: null,
        workingDirectory: project.directory,
      };
    },
    readPlan: ({ path, signal }) =>
      readFile(path, { encoding: "utf8", signal }),
  });
  const capabilities: CapabilityService = new CapabilityService(
    deps.storage,
    core,
  );
  const harness = new ConversationHarnessSettings({
    dataPath: dataDir,
    userCompaction: () => deps.storage.settings.compaction,
    projectCompaction: async (projectId) => {
      const project = storage.projects.get(projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      return (await resolveProjectSettings(deps.storage, project.directory))
        .compaction;
    },
    projectOf: (conversationId) => {
      const conversation = storage.conversations.get(conversationId);
      if (!conversation) throw new Error("Conversation not found");
      return conversation.projectId;
    },
    changed: (projectId, conversationId) =>
      capabilities.notifyChanged(projectId, conversationId),
  });
  const profileModelInfo = createProfileModelInfo({
    customModels: () => deps.providerCatalog.resolvedModels(),
    providerMetadata: async (provider) =>
      (await deps.auth.listProviderMetadata()).find(
        (metadata) => metadata.provider === provider,
      ),
  });
  const profileAvailability = createProfileAvailability({
    parent: (id) => core.getSnapshot(id).config,
    modelInfo: profileModelInfo,
    resources: async ({ projectId, conversationId }, profile) => {
      const project = projectId ? core.projects.get(projectId) : undefined;
      if (projectId && !project)
        throw new Error(`Project not found: ${projectId}`);
      const settings = deps.storage.settings;
      const configuration = projectId
        ? await capabilities.configuration(projectId, conversationId)
        : {
            effective: userCapabilitySelection(settings),
            availableTools: capabilityToolNameSchema.options,
            toolProfileOptions: {
              jira: settings.providers.atlassianProfiles,
              confluence: settings.providers.atlassianProfiles,
              web_search: settings.providers.tavilyProfiles,
            },
          };
      const installed = new Set(
        (
          await tools.definitions(project?.directory ?? deps.storage.paths.home)
        ).map((tool) =>
          tool.name.startsWith("jira_")
            ? "jira"
            : tool.name.startsWith("confluence_")
              ? "confluence"
              : tool.name,
        ),
      );
      const python =
        profile.tools.python_exec === true
          ? await resolvePythonRuntime({
              cwd: project?.directory ?? deps.storage.paths.home,
              manualPath: settings.runtime.pythonExecutablePath,
            })
          : undefined;
      const available = await profileToolAvailability({
        profile,
        installed,
        configuration,
        credentialConfigured: async (key) =>
          Boolean(await deps.auth.credentialType(key)),
        modelAvailable: async (selection) => {
          await profileModelInfo(selection);
        },
        pythonAvailable: python?.available,
      });
      const { skills } = await listAvailableSkills(project?.directory, {
        storageHome: deps.storage.paths.home,
        nerveSkills: deps.nerveSkills.skills,
        agentBrowserSkills: deps.agentBrowserSkills.skills,
      });
      return {
        tools: available,
        skills: new Map(skills.map((skill) => [skill.name, undefined])),
      };
    },
  });
  const subagentHost = createSubagentHost({
    profiles: {
      usable: (context) => subagentProfiles().usable(context),
      find: (context, name) => subagentProfiles().find(context, name),
    },
    models,
    availability: profileAvailability,
    harness,
    parent: (parentId) => {
      const snapshot = core.getSnapshot(parentId);
      return {
        projectId: snapshot.conversation.projectId,
        config: snapshot.config,
      };
    },
    initializeCapabilities: (parentId, childId, profile) =>
      capabilities.initializeChild(
        parentId,
        childId,
        profile,
        deps.nerveSkills.skills,
        deps.agentBrowserSkills.skills,
      ),
  });
  for (const handler of [
    ...createDelegationTools(core, subagentHost),
    ...createAsyncBashTools(core),
  ])
    core.registerCoreTool(handler);
  return { core, storage, capabilities, harness, profileAvailability };
}
