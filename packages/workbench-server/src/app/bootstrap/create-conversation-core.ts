import { clampAgentThinkingLevel } from "@nervekit/harness/models";
import { listPermissionRuleSets } from "../../core-host/permission-rule-sets.js";
import {
  createAgentProfilePort,
  profileDefaults,
} from "../../core-host/agent-profile-policy.js";
import {
  DEFAULT_AGENT_PROFILE,
  explicitValue,
} from "@nervekit/contracts/agent-profiles";
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
  type ConversationCoreOptions,
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
import { createProfileAvailability } from "../../core-host/agent-profile-availability.js";
import { listAvailableSkills } from "../../core-host/resource-loader.js";
import { userCapabilitySelection } from "../../core-host/user-capability-selection.js";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import { createSubagentHost } from "../../core-host/subagent-host.js";
import type { AgentProfileService } from "../../domains/agent-profiles/agent-profile.service.js";
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
  agentProfiles: () => AgentProfileService,
  onProjectDeleted?: ConversationCoreOptions["onProjectDeleted"],
) {
  const dataDir = deps.storage.paths.dataPath;
  mkdirSync(dataDir, { recursive: true });
  const storage = openCoreStorage(deps.storage.paths.sqlitePath);
  const models = createModelPort(deps.auth, deps.providerCatalog, (name) =>
    deps.secrets.get(name),
  );
  const processes = new CoreProcessHost(async (cwd, conversationId) => {
    if (conversationId)
      return (
        await capabilities.settings(
          core.getSnapshot(conversationId).conversation.projectId,
          conversationId,
        )
      ).tools.bash.shellPath;
    return (await resolveProjectSettings(deps.storage, cwd)).tools.bash
      .shellPath;
  });
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
        manualPath: settings.tools.pythonExec.interpreterPath,
      });
      return {
        cwd,
        shellPath: settings.tools.bash.shellPath,
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
    async (cwd, conversationId) => {
      if (conversationId)
        return (
          await capabilities.settings(
            core.getSnapshot(conversationId).conversation.projectId,
            conversationId,
          )
        ).tools.bash;
      return (await resolveProjectSettings(deps.storage, cwd)).tools.bash;
    },
    launchTool,
  );
  const core: ConversationCore = new ConversationCore({
    storage,
    dataDir,
    onProjectDeleted,
    models,
    processes,
    permissions: createPermissionPort(
      deps.storage.paths.home,
      storage,
      async (_cwd, id) =>
        (
          await capabilities.settings(
            core.getSnapshot(id).conversation.projectId,
            id,
          )
        ).tools.bash,
    ),
    toolHost: tools.port,
    turnResources: createTurnResourcesPort({
      home: deps.storage.paths.home,
      tools: tools.definitions,
      skillCatalogs: {
        nerve: deps.nerveSkills,
        agentBrowser: deps.agentBrowserSkills,
      },
      hasExistingSubagents: (id) =>
        (storage.conversations.getSummary(id)?.childCount ?? 0) > 0,
      get capabilities(): CapabilityService {
        return capabilities;
      },
      defaultProfile: async (projectId) => {
        const project = core.projects.get(projectId);
        if (!project) throw new Error(`Project not found: ${projectId}`);
        return (
          (await resolveProjectSettings(deps.storage, project.directory))
            .defaultAgentProfile ?? DEFAULT_AGENT_PROFILE
        );
      },
      get agentProfiles(): AgentProfileService {
        return agentProfiles();
      },
    }),
    agentProfiles: {
      applyProfile: (input) => profilePort.applyProfile(input),
      persistApplication: (id, application) =>
        profilePort.persistApplication(id, application),
      getAppliedProfile: (id) => profilePort.getAppliedProfile(id),
    },
    planApprovalProfile: async (id) => {
      const projectId = core.getSnapshot(id).conversation.projectId;
      return (await capabilities.settings(projectId, id)).tools.planPresent
        .approvalProfile;
    },
    compactionSettings: (id) => harness.compactionSettings(id),
    defaultConfig: (projectId) => applicationDefaults(projectId),
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
    appliedProfile: (id) => profilePort.getAppliedProfile(id),
    projectOf: (conversationId) => {
      const conversation = storage.conversations.get(conversationId);
      if (!conversation) throw new Error("Conversation not found");
      return conversation.projectId;
    },
    changed: (projectId, conversationId) =>
      capabilities.notifyChanged(projectId, conversationId),
  });
  const projectSettings = async (projectId: string) => {
    const project = storage.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return resolveProjectSettings(deps.storage, project.directory);
  };
  const applicationDefaults = async (projectId: string) => {
    const project = storage.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const settings = await projectSettings(projectId);
    const defaults = profileDefaults(settings);
    return {
      model: defaults.model,
      reasoningLevel: defaults.reasoningLevel,
      permissionRuleSetId: defaults.permissionRuleSetId,
      agentProfile: settings.defaultAgentProfile ?? DEFAULT_AGENT_PROFILE,
      instructions: null,
      systemPrompt: null,
      workingDirectory: project.directory,
    };
  };
  const parentInput = (id: string) => {
    const { conversation, config } = core.getSnapshot(id);
    return {
      conversation,
      config,
      projectDir: storage.projects.get(conversation.projectId)!.directory,
    };
  };
  const profilePort = createAgentProfilePort({
    clampThinking: (model, thinking) =>
      clampAgentThinkingLevel(
        model,
        thinking,
        deps.providerCatalog.resolvedModels(),
      ),
    dataPath: dataDir,
    home: deps.storage.paths.home,
    profiles: agentProfiles,
    settings: projectSettings,
    capabilities: () => capabilities,
    harness: () => harness,
    parentInput,
    skillCatalogs: {
      get nerve() {
        return deps.nerveSkills.skills;
      },
      get agentBrowser() {
        return deps.agentBrowserSkills.skills;
      },
    },
  });
  const profileModelInfo = createProfileModelInfo({
    customModels: () => deps.providerCatalog.resolvedModels(),
    providerMetadata: async (provider) =>
      (await deps.auth.listProviderMetadata()).find(
        (metadata) => metadata.provider === provider,
      ),
  });
  const profileAvailability = createProfileAvailability({
    defaults: async (projectId) => {
      const settings = projectId
        ? await projectSettings(projectId)
        : deps.storage.settings;
      const model = settings.defaultModel;
      return { model, reasoningLevel: settings.defaultThinkingLevel };
    },
    parent: (id) => core.getSnapshot(id).config,
    modelInfo: profileModelInfo,
    resources: async (
      { projectId, conversationId, capabilityOverrides },
      profile,
    ) => {
      const project = projectId ? core.projects.get(projectId) : undefined;
      if (projectId && !project)
        throw new Error(`Project not found: ${projectId}`);
      const settings = deps.storage.settings;
      const configuration = projectId
        ? await capabilities.configuration(
            projectId,
            conversationId,
            capabilityOverrides,
          )
        : {
            effective: userCapabilitySelection(settings),
            availableTools: capabilityToolNameSchema.options,
            toolProfileOptions: {
              jira: settings.providers.atlassianProfiles,
              confluence: settings.providers.atlassianProfiles,
              web_search: settings.providers.tavilyProfiles,
            },
          };
      const pythonSetting = profile.tools.python_exec;
      const pythonPayload = explicitValue(pythonSetting);
      const python =
        profile.tools.python_exec !== undefined
          ? await resolvePythonRuntime({
              cwd: project?.directory ?? deps.storage.paths.home,
              manualPath:
                pythonPayload?.settings?.interpreterPath ??
                configuration.effective.toolSettings.python_exec
                  .interpreterPath,
            })
          : undefined;
      const available = await profileToolAvailability({
        profile,
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
    profiles: { usable: (context) => agentProfiles().usable(context) },
    parent: parentInput,
    applicationDefaults,
    apply: (input) => profilePort.applyProfile(input),
    validatePermission: async (id) => {
      const ruleSet = (
        await listPermissionRuleSets(deps.storage.paths.home)
      ).find((r) => r.id === id && r.enabled);
      if (
        !ruleSet ||
        ruleSet.rules.some((rule) => rule.enabled && rule.decision === "prompt")
      )
        throw new Error(
          `Permission rule set "${id}" is not sub-agent safe; choose an enabled rule set without user prompts.`,
        );
    },
  });
  for (const handler of [
    ...createDelegationTools(core, subagentHost),
    ...createAsyncBashTools(core),
  ])
    core.registerCoreTool(handler);
  return { core, storage, capabilities, harness, profileAvailability };
}
