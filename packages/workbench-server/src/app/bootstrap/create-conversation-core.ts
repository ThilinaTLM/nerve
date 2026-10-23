import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ReleasedProjectMigration } from "../../infrastructure/migrations/steps/0002-agent-profiles/released-project.js";
import { commitProjectTrust } from "../../infrastructure/migrations/steps/0002-agent-profiles/released-project-trust.js";
import { discoverReleasedSkillSources } from "../../infrastructure/migrations/steps/0002-agent-profiles/released-resources.js";
import {
  readText,
  safePath,
  writeProtected,
} from "../../infrastructure/migrations/steps/0002-agent-profiles/files.js";
import {
  sha256,
  jsonBytes,
} from "../../infrastructure/migrations/steps/0002-agent-profiles/released-format.js";
import { createProfileTransitions } from "../../infrastructure/configuration/agent-configuration/profile-transitions.js";
import { agentConfigurationOperations } from "../../infrastructure/configuration/agent-configuration/scoped-configuration-operations.js";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { Settings, BashToolSettings } from "@nervekit/contracts/settings";
import { createScopedPermissionSource } from "../../core-host/scoped-permission-source.js";
import { resolveAgentModel } from "@nervekit/harness/models";
import { scopedConversationCreation } from "../../core-host/scoped-conversation-creation.js";
import { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { bundledAgentProfiles } from "../../infrastructure/configuration/agent-configuration/builtins.js";
import { createScopedAgentConfiguration } from "../../core-host/scoped-agent-configuration.js";
import { scopedTurnResources } from "../../core-host/scoped-turn-resources.js";
import { clampAgentThinkingLevel } from "@nervekit/harness/models";
import { mkdirSync } from "node:fs";
import { createId } from "@nervekit/contracts";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import {
  LaunchTool,
  type LaunchToolOptions,
} from "../../core-host/launch-tool.js";
import { readFile, realpath } from "node:fs/promises";
import {
  ConversationCore,
  type ConversationCoreOptions,
  openCoreStorage,
  createDelegationTools,
  createAsyncBashTools,
} from "@nervekit/conversation-core";
import {
  resolvePythonRuntime,
  resolveBashShellConfig,
  type ToolExecutionContext,
} from "@nervekit/tools/execution";
import { explainImageWithModel } from "@nervekit/harness/models";
import { listAvailableSkills } from "../../core-host/resource-loader.js";
import { createModelPort } from "../../core-host/model.adapter.js";
import { createPermissionPort } from "../../core-host/permission.adapter.js";
import { CoreProcessHost } from "../../core-host/process.adapter.js";
import { createToolHostPort } from "../../core-host/tool-host.adapter.js";
import type { RuntimeDeps } from "./create-runtime-services.js";
import { ImageGenerationService } from "../../domains/image-generation/image-generation.service.js";
import { OpenAiCodexImageGenerationProvider } from "../../domains/image-generation/providers/openai-codex-image-generation.provider.js";

export function createConversationCore(
  deps: RuntimeDeps,
  launchServices: Pick<LaunchToolOptions, "launches" | "definitions">,
  onProjectDeleted?: ConversationCoreOptions["onProjectDeleted"],
  processHost?: CoreProcessHost,
) {
  const dataDir = deps.storage.paths.dataPath;
  mkdirSync(dataDir, { recursive: true });
  const storage = openCoreStorage(deps.storage.paths.sqlitePath);
  const models = createModelPort(deps.auth, deps.providerCatalog, (name) =>
    deps.secrets.get(name),
  );
  const processes =
    processHost ??
    new CoreProcessHost(async (_cwd, conversationId) => {
      if (!conversationId) return undefined;
      const view = await agentConfiguration.getEffective(conversationId);
      if (view.status !== "available")
        throw new Error("Agent configuration unavailable");
      return view.resolution.settings.tools?.bash?.settings?.shellPath;
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
  const captureExecutionResources = async (
    cwd: string,
    settings: LeadSettingsOverrides,
    forcePython = false,
  ) => {
    const providers = structuredClone(deps.storage.settings.providers);
    const modelConfiguration = structuredClone(
      deps.storage.configuration.providers,
    );
    const python =
      settings.tools?.python_exec?.enabled || forcePython
        ? await resolvePythonRuntime({
            cwd,
            manualPath: settings.tools?.python_exec?.settings?.interpreterPath,
          })
        : undefined;
    let shell: { available: true; path: string } | { available: false };
    try {
      shell = {
        available: true,
        path: await realpath(
          resolveBashShellConfig({
            shellPath: settings.tools?.bash?.settings?.shellPath,
          }).shell,
        ),
      };
    } catch {
      shell = { available: false };
    }
    return { providers, modelConfiguration, python, shell };
  };
  let credentialEpoch = 0;
  const tools = createToolHostPort(
    processes,
    async (input) => {
      while (true) {
        input.signal.throwIfAborted();
        const credentialVersion = credentialEpoch;
        let isCurrent = () => true;
        const blocked = (code: string, pointer = "") => ({
          kind: "configuration_blocked" as const,
          request: {
            diagnostics: [
              {
                scope: "conversation" as const,
                scopeId: input.conversationId,
                document: "agent.json",
                path: agentConfiguration.paths.agent({
                  scope: "conversation",
                  conversationId: input.conversationId,
                }),
                code,
                pointer,
                affectedCapability: "tool-execution",
                recoveryChoices: [
                  "retry" as const,
                  "reload" as const,
                  "repair" as const,
                ],
              },
            ],
          },
        });
        let settings: LeadSettingsOverrides;
        let resources: Awaited<ReturnType<typeof captureExecutionResources>>;
        if (input.requestCaptureId) {
          const captured = scopedConfiguration.getCapture(
            input.requestCaptureId,
          );
          if (!captured || captured.conversationId !== input.conversationId)
            return blocked("missing-request-capture");
          settings = captured.settings;
          resources = captured.executorResources as Awaited<
            ReturnType<typeof captureExecutionResources>
          >;
        } else {
          const captured = await agentConfiguration.captureEffective(
            input.conversationId,
          );
          if (captured.view.status !== "available")
            return {
              kind: "configuration_blocked",
              request: { diagnostics: [...captured.view.diagnostics] },
            };
          isCurrent = captured.isCurrent;
          settings = structuredClone(captured.view.resolution.settings);
          resources = await captureExecutionResources(
            input.cwd,
            settings,
            input.toolName === "python_exec",
          );
        }
        const { providers, modelConfiguration, python, shell } = resources;
        const bash = structuredClone(
          settings.tools!.bash!.settings as BashToolSettings,
        );
        const spawnsShell =
          input.toolName === "bash" ||
          (input.toolName === "launch" &&
            ["start", "restart"].includes(
              String((input.args as Record<string, unknown>).action),
            ));
        if (spawnsShell) {
          if (!shell.available)
            return blocked(
              "shell-unavailable",
              "/tools/bash/settings/shellPath",
            );
          bash.shellPath = shell.path;
        }
        const atlassian = (provider: "jira" | "confluence") =>
          providers.atlassianProfiles.find(
            (profile) => profile.id === settings.tools?.[provider]?.profileId,
          );
        const toolProvider = input.toolName.startsWith("jira_")
          ? "jira"
          : input.toolName.startsWith("confluence_")
            ? "confluence"
            : input.toolName === "web_search"
              ? "tavily"
              : undefined;
        const selectedAccount =
          toolProvider === "jira" || toolProvider === "confluence"
            ? atlassian(toolProvider)
            : toolProvider === "tavily"
              ? providers.tavilyProfiles.find(
                  (profile) =>
                    profile.id === settings.tools?.web_search?.profileId,
                )
              : undefined;
        if (toolProvider && !selectedAccount)
          return blocked(
            "missing-account-reference",
            `/tools/${toolProvider === "tavily" ? "web_search" : toolProvider}/profileId`,
          );
        const credentialKey =
          toolProvider === "jira" || toolProvider === "confluence"
            ? `atlassian:${selectedAccount!.id}`
            : toolProvider === "tavily"
              ? `tavily:${selectedAccount!.id}`
              : undefined;
        const apiKey = credentialKey
          ? await deps.auth.getApiKey(credentialKey).catch(() => undefined)
          : undefined;
        if (credentialKey && !apiKey) return blocked("missing-credentials");
        if (input.toolName === "python_exec" && (!python || !python.available))
          return blocked(
            "python-unavailable",
            "/tools/python_exec/settings/interpreterPath",
          );
        const explanation = settings.tools?.explain_image?.settings;
        const explanationModel =
          input.toolName === "explain_image" && explanation?.model
            ? await models
                .resolve(explanation.model, modelConfiguration)
                .catch(() => undefined)
            : undefined;
        if (input.toolName === "explain_image" && !explanationModel)
          return blocked(
            "model-required",
            "/tools/explain_image/settings/model",
          );
        const context: ToolExecutionContext = {
          cwd: input.cwd,
          shellPath: bash.shellPath,
          pythonRuntime: python?.available ? python : undefined,
          kroki: settings.tools?.kroki_export
            ?.settings as Settings["tools"]["kroki"],
          getApiKey: async (provider) =>
            provider === toolProvider ? apiKey : undefined,
          getProviderConfig: async (provider) =>
            provider === "jira" || provider === "confluence"
              ? {
                  ...atlassian(provider),
                  enabled: Boolean(atlassian(provider)),
                }
              : undefined,
          generateImage: (request) =>
            imageGeneration.generate(
              request,
              settings.tools!.generate_image!
                .settings as Settings["tools"]["imageGeneration"],
            ),
          explainImage: async (request) => {
            if (!explanationModel || !explanation?.model)
              throw new Error("Image explanation model was not prepared");
            const text = await explainImageWithModel({
              model: explanationModel.model,
              auth: explanationModel,
              image: {
                type: "image",
                data: Buffer.from(request.data).toString("base64"),
                mimeType: request.mimeType,
              },
              prompt: request.prompt,
              thinkingLevel: explanation.thinkingLevel!,
              signal: request.signal,
            });
            return { explanation: text, model: explanation.model };
          },
        };
        if (!isCurrent() || credentialVersion !== credentialEpoch) continue;
        const selectedTool = capabilityToolNameSchema.safeParse(
          input.toolName.startsWith("jira_")
            ? "jira"
            : input.toolName.startsWith("confluence_")
              ? "confluence"
              : input.toolName,
        );
        const modelTarget =
          input.toolName === "explain_image" && explanation?.model
            ? {
                model: modelConfiguration.models.find(
                  (model) =>
                    model.provider === explanation.model!.provider &&
                    model.modelId === explanation.model!.modelId,
                ),
                provider: modelConfiguration.providers.find(
                  (provider) => provider.id === explanation.model!.provider,
                ),
              }
            : null;
        return {
          context,
          bash,
          isCurrent: () => isCurrent() && credentialVersion === credentialEpoch,
          target: JSON.parse(
            JSON.stringify({
              toolConfiguration: selectedTool.success
                ? (settings.tools?.[selectedTool.data] ?? null)
                : null,
              modelConfiguration: modelTarget,
              python:
                input.toolName === "python_exec" && python?.available
                  ? python
                  : null,
              account: selectedAccount ?? null,
              shellPath: spawnsShell ? (bash.shellPath ?? null) : null,
            }),
          ) as Record<string, unknown>,
        };
      }
    },
    launchTool,
  );
  let migrationTrustEpoch = 0;
  const projectMigration = new ReleasedProjectMigration({
    home: deps.storage.paths.home,
    directory: (id) => {
      const project = storage.projects.get(id);
      if (!project) throw new Error("Project not found");
      return project.directory;
    },
    io: {
      read(path) {
        safePath(path);
        return existsSync(path) ? readText(path) : undefined;
      },
      write: writeProtected,
      remove(path) {
        safePath(path);
        rmSync(path, { force: true });
      },
    },
    discover: (directory, inputs) =>
      discoverReleasedSkillSources(deps.storage.paths.home, directory, inputs),
    originalTrust: (id) => storage.trustedResources.list(id),
    commitTrust: (id, original, targets, createdAt) => {
      commitProjectTrust(storage, id, original, targets, createdAt);
      migrationTrustEpoch++;
    },
    report: (id, messages) =>
      writeProtected(
        join(
          deps.storage.paths.home,
          "migrations/reports",
          "0002-project-" + sha256(id) + ".json",
        ),
        jsonBytes({
          step: "0002-project-" + sha256(id),
          description: "Released project configuration conversion",
          completedAt: new Date().toISOString(),
          setAside: [],
          losses: messages.map((reason) => ({ reason, count: 1 })),
        }),
      ),
  });
  const discoveredSkills = new Map<string, string[]>();
  const discoveries = new Map<string, Promise<void>>();
  const resourceFingerprint = () =>
    JSON.stringify({
      discoveredSkills: [...discoveredSkills],
      migrationTrustEpoch,
      credentialEpoch,
      providers: deps.storage.settings.providers,
      modelConfiguration: deps.storage.configuration.providers,
      models: deps.providerCatalog.resolvedModels(),
      nerve: deps.nerveSkills.skills,
      browser: deps.agentBrowserSkills.skills,
      trust: core.trust.generation,
      projects: core.projects.generation,
    });
  let resourceVersion = 0;
  let previousResourceFingerprint = "";
  const resourceGeneration = () => {
    const fingerprint = resourceFingerprint();
    if (fingerprint !== previousResourceFingerprint) {
      resourceVersion++;
      previousResourceFingerprint = fingerprint;
    }
    return resourceVersion;
  };
  const agentConfiguration = new AgentConfigurationService({
    home: deps.storage.paths.home,
    projectDirectory: (id) => storage.projects.get(id)?.directory,
    conversationOwner: (id) => {
      const conversation = storage.conversations.get(id);
      if (!conversation) throw new Error("Conversation not found");
      return {
        projectId: conversation.projectId,
        role: conversation.parentConversationId ? "child" : "lead",
      };
    },
    builtins: bundledAgentProfiles,
    prepareUser: () => projectMigration.ensureUser(),
    retryUserMigration: () => projectMigration.retryUser(),
    prepareProject: (id) => projectMigration.ensure(id),
    retryProjectMigration: (id) => projectMigration.retry(id),
    isProjectAgentTrusted: (id, path, digest) => {
      const row = storage.trustedResources.find(
        "project_capabilities",
        id,
        path,
      );
      return row?.status === "trusted" && row.contentDigest === digest;
    },
    transitionReconciled: (id, receipt) =>
      profileTransitions.reconciled(id, receipt),
    publish: (domain, scope) => {
      admissionPolicy.invalidate();
      if (domain === "profile")
        void deps.events
          .publish("agentProfiles.changed", {
            ...(scope.scope === "project"
              ? { projectId: scope.projectId }
              : {}),
          })
          .catch((error) => {
            void deps.logger.warn("Profile catalog notification failed", {
              error,
            });
          });
    },
    isProfileTrusted: (projectId, path, digest) =>
      core.trust.isTrusted("agent_profile", projectId, path, digest),
    prepareResources: (projectId) => {
      const key = `${projectId}:${storage.projects.get(projectId)!.directory}`;
      let pending = discoveries.get(key);
      if (!pending) {
        pending = listAvailableSkills(
          storage.projects.get(projectId)!.directory,
          {
            storageHome: deps.storage.paths.home,
            nerveSkills: deps.nerveSkills.skills,
            agentBrowserSkills: deps.agentBrowserSkills.skills,
          },
        ).then(({ skills }) => {
          discoveredSkills.set(
            projectId,
            skills
              .filter(
                (skill) =>
                  skill.source === "project" || skill.source === "user",
              )
              .map((skill) => skill.name),
          );
        });
        discoveries.set(key, pending);
      }
      return pending;
    },
    captureResources: (projectId) => {
      const generation = resourceGeneration();
      const models = deps.providerCatalog.resolvedModels();
      const providers = structuredClone(deps.storage.settings.providers);
      return {
        options: {
          eligibleSkills: {
            file: projectId ? (discoveredSkills.get(projectId) ?? []) : [],
            nerve: deps.nerveSkills.skills.map((skill) => skill.name),
            agentBrowser: deps.agentBrowserSkills.skills.map(
              (skill) => skill.name,
            ),
          },
          clampThinking: (model, thinking) =>
            clampAgentThinkingLevel(model, thinking, models),
          referenceAvailable: (pointer, value) => {
            if (pointer.endsWith("/model")) {
              const selection = value as { provider: string; modelId: string };
              try {
                const model = resolveAgentModel(selection, models);
                return (
                  model.provider === selection.provider &&
                  model.id === selection.modelId
                );
              } catch {
                return false;
              }
            }
            if (pointer.endsWith("/profileId")) {
              const profiles = pointer.includes("/web_search/")
                ? providers.tavilyProfiles
                : providers.atlassianProfiles;
              return profiles.some((profile) => profile.id === value);
            }
            return true;
          },
        },
        isCurrent: () => generation === resourceGeneration(),
      };
    },
  });
  const scopedCreation = scopedConversationCreation(agentConfiguration, (id) =>
    admissionPolicy.validateChildPermission(id),
  );
  const profileTransitions = createProfileTransitions(
    agentConfiguration,
    storage,
    (event) => core.publishConfigurationEvent(event),
  );
  const configurationOperations =
    agentConfigurationOperations(agentConfiguration);
  const scopedConfiguration = createScopedAgentConfiguration({
    workingDirectory: (id) =>
      storage.conversations.getContext(id)?.workingDirectory,
    initializeConversation: scopedCreation.initializeConversation,
    prepareCreation: scopedCreation.prepareCreation,
    profiles: profileTransitions.port,
    captureExecutorResources: (input, settings) =>
      captureExecutionResources(input.config.workingDirectory, settings),
    resourcesGeneration: resourceGeneration,
    service: agentConfiguration,
    prepare: scopedTurnResources({
      home: deps.storage.paths.home,
      service: agentConfiguration,
      tools: tools.definitions,
      nerveSkills: deps.nerveSkills.skills,
      agentBrowserSkills: deps.agentBrowserSkills.skills,
      hasChildren: (id) =>
        (storage.conversations.getSummary(id)?.childCount ?? 0) > 0,
    }),
  });
  const admissionPolicy = createScopedPermissionSource({
    home: deps.storage.paths.home,
    storage,
    agents: agentConfiguration,
    trustGeneration: () =>
      core.trust.generation + core.projects.generation + migrationTrustEpoch,
    requestGenerations: (id) => scopedConfiguration.getCapture(id)?.generations,
  });
  const core: ConversationCore = new ConversationCore({
    configuration: scopedConfiguration.port,
    storage,
    dataDir,
    onProjectDeleted,
    models,
    processes,
    permissions: createPermissionPort(
      deps.storage.paths.home,
      storage,
      admissionPolicy,
    ),
    toolHost: tools.port,
    planApprovalProfile: async (id, requestCaptureId) => {
      if (requestCaptureId) {
        const capture = scopedConfiguration.getCapture(requestCaptureId);
        if (!capture || capture.conversationId !== id)
          throw new Error("Plan request configuration capture unavailable");
        return (
          capture.settings.tools?.plan_present?.settings?.approvalProfile ??
          "coding"
        );
      }
      // Recovered calls have no process-local capture; use current configuration.
      const view = await agentConfiguration.getEffective(id);
      if (view.status !== "available")
        throw new Error("Agent configuration unavailable");
      return (
        view.resolution.settings.tools?.plan_present?.settings
          ?.approvalProfile ?? "coding"
      );
    },
    defaultConfig: (projectId) => applicationDefaults(projectId),
    readPlan: ({ path, signal }) =>
      readFile(path, { encoding: "utf8", signal }),
  });
  void agentConfiguration.initialize().catch((error) => {
    void deps.logger.warn("Agent configuration initialization failed", {
      error,
    });
  });
  deps.events.subscribeNotify((event) => {
    if (
      ![
        "settings.updated",
        "providers.catalog_changed",
        "auth.providers_changed",
      ].includes(event.type)
    )
      return;
    credentialEpoch++;
    admissionPolicy.invalidate();
    agentConfiguration.invalidateResources();
    void core.retryConfigurationBlocked().catch((error) => {
      void deps.logger.warn("Configuration health retry failed", { error });
    });
  });
  agentConfiguration.subscribeHealth((scope) => {
    admissionPolicy.invalidate();
    void core
      .reconcilePlanReviews(
        scope.scope === "conversation" ? scope.conversationId : undefined,
      )
      .catch((error) => {
        void deps.logger.warn("Profile transition recovery failed", { error });
      });
    void core
      .retryConfigurationBlocked(
        scope.scope === "conversation" ? scope.conversationId : undefined,
      )
      .catch((error) => {
        void deps.logger.warn("Configuration health retry failed", { error });
      });
  });
  core.subscribe((change) => {
    if (change.kind === "conversation_deleted")
      agentConfiguration.forgetConversation(change.conversationId);
  });
  agentConfiguration.subscribeSummary((id) => {
    const summary = storage.conversations.getSummary(id);
    if (summary) core.publishAgentSummary(id);
  });

  const applicationDefaults = async (projectId: string) => {
    const project = storage.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const { settings, profile } = await scopedCreation.defaults(projectId);
    return {
      model: settings.model!,
      reasoningLevel: settings.reasoningLevel!,
      permissionRuleSetId: settings.permissionRuleSetId!,
      agentProfile: profile,
      instructions: null,
      systemPrompt: null,
      workingDirectory: project.directory,
    };
  };
  const subagentHost = scopedCreation.childHost;
  for (const handler of [
    ...createDelegationTools(core, subagentHost),
    ...createAsyncBashTools(core),
  ])
    core.registerCoreTool(handler);
  return {
    core,
    storage,
    agentConfiguration,
    configurationOperations,
    scopedConfiguration,
    admissionPolicy,
    subagentHost,
  };
}
