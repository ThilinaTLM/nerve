import { ConversationTitleService } from "../../domains/conversation-titles/title.service.js";
import { projectGitRemotes } from "../../core-host/project-git-remotes.js";
import {
  diagramServer,
  imagegenSettings,
  resolveExecutionAccounts,
} from "../../core-host/legacy-extension-context.js";
import {
  assertExtensionToolOffered,
  extensionAvailability,
} from "../../core-host/extension-availability.js";
import { createExtensionPorts } from "../../core-host/extension-ports.js";
import { hostRegistry } from "../../core-host/host-tools.js";
import type { AccountsReader } from "../../domains/accounts/accounts.service.js";
import { conversationExtensions } from "../../core-host/conversation-extensions.js";
import { ExtensionSettingsService } from "../../infrastructure/configuration/extensions/extension-settings-service.js";
import { extensionSettingsDefinitions } from "@nervekit/extensions";
import { type QuickScriptContext } from "@nervekit/tools/quick-script";
import { capabilityToolNameSchema } from "@nervekit/contracts/capabilities";
import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { projectMigrationTrust } from "../../infrastructure/configuration/project-migration/project-migration-trust.js";
import {
  projectConfigurationDescriptors,
  projectConfigurationTrustKinds,
} from "../../infrastructure/configuration/project-migration/descriptors.js";
import { createProfileTransitions } from "../../infrastructure/configuration/agent-configuration/profile-transitions.js";
import { agentConfigurationOperations } from "../../infrastructure/configuration/agent-configuration/scoped-configuration-operations.js";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import {
  defaultKrokiToolSettings,
  type BashToolSettings,
} from "@nervekit/contracts/settings";
import { createScopedPermissionSource } from "../../core-host/scoped-permission-source.js";
import { resolveAgentModel } from "@nervekit/harness/models";
import { scopedConversationCreation } from "../../core-host/scoped-conversation-creation.js";
import { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { bundledAgentProfiles } from "../../infrastructure/configuration/agent-configuration/builtins/index.js";
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
  ToolExecutionError,
  type ToolExecutionContext,
} from "@nervekit/tools/execution";
import {
  classifyQuickScriptArguments,
  quickScriptToolRisk,
} from "@nervekit/tools/quick-script";
import type { ToolName } from "@nervekit/contracts/tools";
import { explainImageWithModel } from "@nervekit/harness/models";
import { listAvailableSkills } from "../../core-host/resource-loader.js";
import { createModelPort } from "../../core-host/model.adapter.js";
import { createPermissionPort } from "../../core-host/permission.adapter.js";
import { CoreProcessHost } from "../../core-host/process.adapter.js";
import { createToolHostPort } from "../../core-host/tool-host.adapter.js";
import { createQuickScriptAuthorizer } from "../../core-host/quick-script-broker.js";
import { isToolEnabled } from "../../core-host/tool-enablement.js";
import { createExecutionAdmission } from "../../core-host/execution-admission/admission.js";
import type { RuntimeDeps } from "./create-runtime-services.js";
import { ImageGenerationService } from "../../domains/image-generation/image-generation.service.js";
import { OpenAiCodexImageGenerationProvider } from "../../domains/image-generation/providers/openai-codex-image-generation.provider.js";

export function createConversationCore(
  deps: RuntimeDeps & { accounts: AccountsReader },
  launchServices: Pick<LaunchToolOptions, "launches" | "definitions">,
  onProjectDeleted?: ConversationCoreOptions["onProjectDeleted"],
  processHost?: CoreProcessHost,
  migrations?: ProjectMigrationService,
  onConversationFailure?: Parameters<typeof openCoreStorage>[1],
) {
  const dataDir = deps.storage.paths.dataPath;
  mkdirSync(dataDir, { recursive: true });
  const storage = openCoreStorage(deps.storage.paths.sqlitePath, (failure) => {
    onConversationFailure?.(failure);
    void deps.logger
      .warn("Conversation read failed; skipped", {
        conversationId: failure.conversationId,
        context: { operation: failure.operation },
        error: failure.error,
      })
      .catch(() => undefined);
  });
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
  const { accounts } = deps;
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
    conversation: { id?: string | undefined; projectId: string },
    cwd: string,
    settings: LeadSettingsOverrides,
    forcePython = false,
  ) => {
    const extensions = await conversationExtensionSettings(
      conversation.id,
      conversation.projectId,
    );
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
    return { extensions, modelConfiguration, python, shell };
  };
  let credentialEpoch = 0;
  let extensionEpoch = 0;
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
            {
              id: input.conversationId,
              projectId: agentConfiguration.paths.locations.conversationOwner(
                input.conversationId,
              ).projectId,
            },
            input.cwd,
            settings,
            input.toolName === "python_exec",
          );
        }
        // Advertising is not authorization: a model can name a tool it was not offered.
        if (
          input.origin === "model" &&
          !isToolEnabled(input.toolName, settings)
        )
          throw new ToolExecutionError(
            "TOOL_NOT_ENABLED",
            `${input.toolName}: not enabled for this conversation`,
          );
        const { extensions, modelConfiguration, python, shell } = resources;
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
            throw new ToolExecutionError(
              "SHELL_UNAVAILABLE",
              `${input.toolName}: no usable shell is configured. Ask the user to set a shell path in Settings → Tools → bash.`,
            );
          bash.shellPath = shell.path;
        }
        const {
          quickScript,
          extensionOn,
          tavilyAccount,
          tavilyKey,
          atlassianAccounts,
        } = await resolveExecutionAccounts({
          toolName: input.toolName,
          extensions,
          accounts,
        });
        const extensionPorts = createExtensionPorts({
          resolution: extensions,
          accounts,
          generateImage: (request) => imageGeneration.generate(request),
          warn: (extensionId, message, data) =>
            void deps.logger.warn("Extension warning", {
              context: { extension: extensionId, message, data },
            }),
        });
        const isExtensionTool = hostRegistry.tools.some(
          (tool) => tool.definition.name === input.toolName,
        );
        // Direct tools of extensions: offered only while available (advertising is not authorization).
        await assertExtensionToolOffered(
          hostRegistry,
          input.toolName,
          extensions,
          accounts,
        );
        if (input.toolName === "python_exec" && (!python || !python.available))
          throw new ToolExecutionError(
            "PYTHON_UNAVAILABLE",
            "python_exec: no usable Python interpreter is configured. Ask the user to set one in Settings → Tools → python_exec.",
          );
        const explanation = settings.tools?.explain_image?.settings;
        const explanationModel =
          input.toolName === "explain_image" && explanation?.model
            ? await models
                .resolve(explanation.model, modelConfiguration)
                .catch(() => undefined)
            : undefined;
        if (input.toolName === "explain_image" && !explanationModel)
          throw new ToolExecutionError(
            "MODEL_REQUIRED",
            "explain_image: no usable image model is configured. Ask the user to choose one in Settings → Tools → explain_image.",
          );
        const context: ToolExecutionContext & QuickScriptContext = {
          cwd: input.cwd,
          shellPath: bash.shellPath,
          pythonRuntime: python?.available ? python : undefined,
          kroki: {
            url: diagramServer(extensions) ?? defaultKrokiToolSettings.url,
          },
          getApiKey: async (provider) =>
            provider === "jira" || provider === "confluence"
              ? atlassianAccounts.get(provider)?.apiKey
              : provider === "tavily"
                ? tavilyKey
                : undefined,
          registry: hostRegistry,
          extensionPorts,
          ...(quickScript || isExtensionTool
            ? {
                ...(quickScript
                  ? {
                      web: {
                        enabled: extensionOn("web"),
                        search: Boolean(tavilyKey),
                      },
                      namespaces: (
                        await extensionAvailability(
                          hostRegistry,
                          extensions,
                          accounts,
                          { checkSecrets: true, ports: extensionPorts },
                        )
                      ).namespaces,
                    }
                  : {}),
                authorizeNested: (request) =>
                  // Only a person's approval of the script sets the ceiling: the
                  // admission stored on the tool call says whether a rule allowed
                  // it or a user approved it (read when the nested call is made).
                  authorizeQuickScriptCall(
                    {
                      toolCallId: input.toolCallId,
                      conversationId: input.conversationId,
                      projectDir: input.projectDir ?? input.cwd,
                      origin: input.origin,
                      cwd: input.cwd,
                      requestCaptureId: input.requestCaptureId,
                      signal: input.signal,
                      admission: {
                        by: userApproved(input.toolCallId) ? "user" : "rule",
                        scriptRisk: quickScript
                          ? classifyQuickScriptArguments(
                              input.args as Record<string, unknown>,
                              hostRegistry,
                            ).risk
                          : quickScriptToolRisk(
                              input.toolName as ToolName,
                              input.args as Record<string, unknown>,
                            ),
                      },
                    },
                    request,
                  ),
              }
            : {}),
          getProviderConfig: async (provider) => {
            if (provider !== "jira" && provider !== "confluence")
              return undefined;
            const account = atlassianAccounts.get(provider);
            return { ...account?.profile, enabled: Boolean(account) };
          },
          imagegen: imagegenSettings(extensions),
          generateImage: (request) => imageGeneration.generate(request),
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
        const selectedTool = capabilityToolNameSchema.safeParse(input.toolName);
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
              // Only quick_script reads extension settings; other approvals must not
              // be invalidated by unrelated extension edits.
              ...(quickScript ? { extensions: extensions.extensions } : {}),
              python:
                input.toolName === "python_exec" && python?.available
                  ? python
                  : null,
              accounts: Object.fromEntries(
                [...atlassianAccounts].map(([product, { profile }]) => [
                  product,
                  profile,
                ]),
              ),
              account: tavilyAccount ?? null,
              shellPath: spawnsShell ? (bash.shellPath ?? null) : null,
            }),
          ) as Record<string, unknown>,
        };
      }
    },
    launchTool,
  );
  const projectMigration =
    migrations ??
    new ProjectMigrationService({
      home: deps.storage.paths.home,
      trust: projectMigrationTrust(
        () => storage,
        projectConfigurationTrustKinds,
      ),
    });
  for (const { type } of projectConfigurationDescriptors)
    projectMigration.register(type);
  const discoveredSkills = new Map<string, string[]>();
  const discoveries = new Map<string, Promise<void>>();
  const resourceFingerprint = () =>
    JSON.stringify({
      discoveredSkills: [...discoveredSkills],
      credentialEpoch,
      extensionEpoch,
      accounts: deps.storage.configuration.accounts,
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
    projectMigration,
    isProjectAgentTrusted: (id, path, digest) => {
      const row = storage.trustedResources.find(
        "project_capabilities",
        id,
        path,
      );
      return row?.status === "trusted" && row.contentDigest === digest;
    },
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
            return true;
          },
        },
        isCurrent: () => generation === resourceGeneration(),
      };
    },
  });
  const extensionSettings = new ExtensionSettingsService({
    paths: agentConfiguration.paths,
    projectMigration,
    definitions: extensionSettingsDefinitions,
    isProjectTrusted: (projectId, path, digest) =>
      core.trust.isTrusted("project_capabilities", projectId, path, digest),
  });
  extensionSettings.subscribe((scope) => {
    // A conversation's own file is written while that conversation is created
    // (a child's frozen settings), so it cannot invalidate that creation.
    if (scope.scope !== "conversation") extensionEpoch++;
  });
  const conversationExtensionSettings = conversationExtensions({
    agents: agentConfiguration,
    extensions: extensionSettings,
  });
  const scopedCreation = scopedConversationCreation(
    agentConfiguration,
    (id) => admissionPolicy.validateChildPermission(id),
    extensionSettings,
  );
  const profileTransitions = createProfileTransitions(agentConfiguration);
  const configurationOperations =
    agentConfigurationOperations(agentConfiguration);
  const scopedConfiguration = createScopedAgentConfiguration({
    workingDirectory: (id) =>
      storage.conversations.getContext(id)?.workingDirectory,
    initializeConversation: scopedCreation.initializeConversation,
    prepareCreation: scopedCreation.prepareCreation,
    profiles: profileTransitions.port,
    captureExecutorResources: (input, settings) =>
      captureExecutionResources(
        input.conversation,
        input.config.workingDirectory,
        settings,
      ),
    resourcesGeneration: resourceGeneration,
    service: agentConfiguration,
    prepare: scopedTurnResources({
      home: deps.storage.paths.home,
      service: agentConfiguration,
      tools: tools.definitions,
      nerveSkills: () => deps.nerveSkills.skills,
      agentBrowserSkills: () => deps.agentBrowserSkills.skills,
      hasChildren: (id) =>
        (storage.conversations.getSummary(id)?.childCount ?? 0) > 0,
      registry: hostRegistry,
      extensions: async (id, projectId) => ({
        resolution: await conversationExtensionSettings(id, projectId),
        accounts,
      }),
    }),
  });
  const admissionPolicy = createScopedPermissionSource({
    projectMigration,
    home: deps.storage.paths.home,
    storage,
    agents: agentConfiguration,
    trustGeneration: () => core.trust.generation + core.projects.generation,
    requestGenerations: (id) => scopedConfiguration.getCapture(id)?.generations,
  });
  const userApproved = (toolCallId: string) => {
    const supervision = storage.toolCalls.get(toolCallId)?.supervision;
    return (
      supervision?.decision === "approval" && Boolean(supervision.approval)
    );
  };
  const authorizeQuickScriptCall = createQuickScriptAuthorizer(
    createExecutionAdmission(admissionPolicy),
    hostRegistry,
  );
  const conversationTitles = new ConversationTitleService({
    settings: () => deps.storage.settings.conversationTitles,
    resolve: (selection) => models.resolve(selection),
    log: (context) => {
      // Failures are warnings so they surface at the default log level.
      const level = context.category === "ready" ? "info" : "warn";
      void deps.logger[level]("Conversation title generation", {
        context,
      }).catch(() => undefined);
    },
  });
  deps.events.subscribeNotify((event) => {
    if (
      event.type === "settings.updated" &&
      !deps.storage.settings.conversationTitles.enabled
    )
      conversationTitles.cancelQueued();
  });
  const core: ConversationCore = new ConversationCore({
    gitRemotes: async (projectId) => {
      const project = storage.projects.get(projectId);
      return project ? projectGitRemotes(project.directory) : [];
    },
    titles: conversationTitles,
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
      projectMigration,
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
        "accounts.changed",
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
    conversationTitles,
    core,
    storage,
    agentConfiguration,
    extensionSettings,
    configurationOperations,
    scopedConfiguration,
    admissionPolicy,
    subagentHost,
  };
}
