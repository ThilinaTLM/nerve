import { consentSourcesOf } from "../../core-host/extensions/extension-catalog/extension-consent.js";
import { toTrustedDigest } from "@nervekit/contracts/core";
import { lazyTrust } from "./lazy-trust.js";
import { userTrustWrites } from "../../infrastructure/configuration/trusted-write.js";
import { createProjectSkillTrust } from "../../core-host/resources/project-skill-trust.js";
import { createConversationTitles } from "./create-conversation-titles.js";
import { projectGitRemotes } from "../../core-host/project-git-remotes.js";
import {
  assertExtensionToolOffered,
  extensionAvailability,
} from "../../core-host/extensions/extension-availability.js";
import {
  createExtensionPorts,
  extensionStates,
  selectedAccountsTarget,
} from "../../core-host/extensions/extension-ports.js";
import { createHostExtensionCatalog } from "../../core-host/host-tools.js";
import type { ExtensionCatalog } from "../../core-host/extensions/extension-catalog/extension-catalog.js";
import type { AccountScopes } from "../../domains/accounts/accounts.service.js";
import { conversationExtensions } from "../../core-host/extensions/conversation-extensions.js";
import { ExtensionSettingsService } from "../../infrastructure/configuration/extensions/extension-settings-service.js";
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
import type { BashToolSettings } from "@nervekit/contracts/settings";
import { conversationAgentBlocked } from "./conversation-agent-blocked.js";
import type { LaunchDefinitionService } from "../../domains/launch-definitions/launch-definition.service.js";
import { resolveShell } from "./resolve-shell.js";
import { createLaunchesAgentPort } from "../../core-host/configuration/launches-agent-port.js";
import { createResourceRegistry } from "../../core-host/configuration/create-resource-registry.js";
import { createConfigurationAgentPort } from "../../core-host/configuration/configuration-agent-port.js";
import { createScopedPermissionSource } from "../../core-host/permissions/scoped-permission-source.js";
import { scopedConversationCreation } from "../../core-host/configuration/scoped-conversation-creation.js";
import { AgentConfigurationService } from "../../infrastructure/configuration/agent-configuration/agent-configuration-service.js";
import { bundledAgentProfiles } from "../../infrastructure/configuration/agent-configuration/builtins/index.js";
import { createScopedAgentConfiguration } from "../../core-host/configuration/scoped-agent-configuration.js";
import type { ExtensionStore } from "../../core-host/extensions/extension-store/extension-store.js";
import { scopedTurnResources } from "../../core-host/resources/scoped-turn-resources.js";
import { clampAgentThinkingLevel } from "@nervekit/harness/models";
import { mkdirSync } from "node:fs";
import { createId } from "@nervekit/contracts";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import {
  LaunchRuns,
  type LaunchRunsOptions,
} from "../../core-host/launch-runs.js";
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
  ToolExecutionError,
  type ToolExecutionContext,
} from "@nervekit/tools/execution";
import {
  classifyQuickScriptArguments,
  quickScriptToolRisk,
} from "@nervekit/tools/quick-script";
import { createModelPort } from "../../core-host/model.adapter.js";
import { createModelHosts } from "../../core-host/model-hosts.js";
import { createPermissionPort } from "../../core-host/permissions/permission.adapter.js";
import { CoreProcessHost } from "../../core-host/process.adapter.js";
import { createToolHostPort } from "../../core-host/tool-host.adapter.js";
import { createQuickScriptAuthorizer } from "../../core-host/quick-script-broker.js";
import { isToolEnabled } from "../../core-host/tool-enablement.js";
import { createExecutionAdmission } from "../../core-host/permissions/execution-admission/admission.js";
import type { RuntimeDeps } from "./create-runtime-services.js";
import {
  discoverFileSkillNames,
  resourceGenerationOf,
  referenceAvailable,
} from "./agent-resource-capture.js";
import { mcpRunOf } from "../../domains/mcp/mcp-enablement.js";
import {
  createMcpHub,
  createMcpService,
  McpServerNames,
} from "./create-mcp.js";
import { ImageGenerationService } from "../../domains/image-generation/image-generation.service.js";
import { OpenAiCodexImageGenerationProvider } from "../../domains/image-generation/providers/openai-codex-image-generation.provider.js";

export function createConversationCore(
  deps: RuntimeDeps & {
    accounts: AccountScopes;
    extensionCatalog?: ExtensionCatalog;
    extensionStore: ExtensionStore;
  },
  launchServices: Pick<LaunchRunsOptions, "launches"> & {
    definitions: LaunchDefinitionService;
  },
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
  const extensionCatalog =
    deps.extensionCatalog ??
    createHostExtensionCatalog({
      home: deps.storage.paths.home,
      consent: consentSourcesOf(() => core),
    });
  /** The directory of a project, to find its own extensions. */
  const projectDirectory = (projectId: string) =>
    core.projects.get(projectId)?.directory;
  const requireProject = (projectId: string) => {
    const project = core.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    return project;
  };
  const imageGeneration = new ImageGenerationService([
    new OpenAiCodexImageGenerationProvider(deps.auth),
  ]);
  const modelHosts = createModelHosts({
    models,
    configuration: () => deps.storage.configuration.providers,
    agents: () => agentConfiguration,
    images: {
      generate: (request) => imageGeneration.generate(request),
      ready: (model) => imageGeneration.ready(model),
      listModels: () => imageGeneration.listModels(),
    },
  });
  const mcpParts = createMcpHub(deps, () => core);
  const { hub: mcp, catalog: mcpCatalog } = mcpParts;
  const launchRuns = new LaunchRuns({
    launches: launchServices.launches,
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
      void launchRuns.changed(event.type, launch).catch((error) => {
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
    const python =
      settings.tools?.python_exec?.enabled || forcePython
        ? await resolvePythonRuntime({
            cwd,
            manualPath: settings.tools?.python_exec?.settings?.interpreterPath,
          })
        : undefined;
    const shell = await resolveShell(settings.tools?.bash?.settings?.shellPath);
    return { extensions, python, shell, projectId: conversation.projectId };
  };
  let credentialEpoch = 0;
  let extensionEpoch = 0;
  const tools = createToolHostPort(processes, async (input) => {
    while (true) {
      input.signal.throwIfAborted();
      const credentialVersion = credentialEpoch;
      let isCurrent = () => true;
      const blocked = (code: string, pointer = "") =>
        conversationAgentBlocked(
          agentConfiguration,
          input.conversationId,
          code,
          pointer,
        );
      let settings: LeadSettingsOverrides;
      let resources: Awaited<ReturnType<typeof captureExecutionResources>>;
      if (input.requestCaptureId) {
        const captured = scopedConfiguration.getCapture(input.requestCaptureId);
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
      if (input.origin === "model" && !isToolEnabled(input.toolName, settings))
        throw new ToolExecutionError(
          "TOOL_NOT_ENABLED",
          `${input.toolName}: not enabled for this conversation`,
        );
      const { extensions, python, shell } = resources;
      const accounts = deps.accounts.reader(resources.projectId);
      const bash = structuredClone(
        settings.tools!.bash!.settings as BashToolSettings,
      );
      const spawnsShell = input.toolName === "bash";
      if (spawnsShell) {
        if (!shell.available)
          throw new ToolExecutionError(
            "SHELL_UNAVAILABLE",
            `${input.toolName}: no usable shell is configured. Ask the user to set a shell path in Settings → Tools → bash.`,
          );
        bash.shellPath = shell.path;
      }
      // The extensions of the conversation's project: its own, the user's and the built-ins.
      const registry = await extensionCatalog.registryFor(
        input.projectDir ?? input.cwd,
      );
      const quickScript = input.toolName === "quick_script";
      const scriptRisk = quickScript
        ? (
            await classifyQuickScriptArguments(
              input.args as Record<string, unknown>,
              registry,
            )
          ).risk
        : undefined;
      const extensionPorts = createExtensionPorts({
        resolution: extensions,
        accounts,
        models: modelHosts,
        store: deps.extensionStore,
        projectId: resources.projectId,
        warn: (extensionId, message, data) =>
          void deps.logger.warn("Extension warning", {
            context: { extension: extensionId, message, data },
          }),
      });
      const isExtensionTool = registry.tools.some(
        (tool) => tool.definition.name === input.toolName,
      );
      // Direct tools of extensions: offered only while available (advertising is not authorization).
      await assertExtensionToolOffered(
        registry,
        input.toolName,
        extensions,
        accounts,
        modelHosts,
        { store: deps.extensionStore, projectId: resources.projectId },
      );
      if (input.toolName === "python_exec" && (!python || !python.available))
        throw new ToolExecutionError(
          "PYTHON_UNAVAILABLE",
          "python_exec: no usable Python interpreter is configured. Ask the user to set one in Settings → Tools → python_exec.",
        );
      const context: ToolExecutionContext & QuickScriptContext = {
        cwd: input.cwd,
        shellPath: bash.shellPath,
        pythonRuntime: python?.available ? python : undefined,
        registry: registry,
        extensionPorts,
        ...(quickScript
          ? {
              configurationAgent: createConfigurationAgentPort({
                registry: configurationResources,
                agentConfiguration,
                policy: admissionPolicy,
                home: deps.storage.paths.home,
                conversationId: input.conversationId,
                projectDirectory: input.projectDir ?? input.cwd,
                cwd: input.cwd,
                availableModels: () => deps.providerCatalog.resolvedModels(),
              }),
              launchesAgent: createLaunchesAgentPort({
                definitions: launchServices.definitions,
                project: () => requireProject(resources.projectId),
                runs: launchRuns,
                caller: {
                  conversationId: input.conversationId,
                  origin: input.origin,
                  signal: input.signal,
                },
                shell,
              }),
              mcpAgent: mcp.port(
                mcpRunOf(
                  resources.projectId,
                  input.projectDir ?? input.cwd,
                  settings,
                ),
              ),
              extensionAgent: extensionCatalog.agentPort({
                projectDir: input.projectDir ?? input.cwd,
                switchOf: (id) => extensionStates(extensions)(id)?.enabled,
              }),
            }
          : {}),
        ...(quickScript || isExtensionTool
          ? {
              ...(quickScript
                ? {
                    namespaces: (
                      await extensionAvailability(
                        registry,
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
                        ? scriptRisk!
                        : quickScriptToolRisk(
                            input.toolName,
                            input.args as Record<string, unknown>,
                            input.projectDir ?? input.cwd,
                          ),
                    },
                  },
                  request,
                ),
            }
          : {}),
      };
      if (!isCurrent() || credentialVersion !== credentialEpoch) continue;
      const selectedTool = capabilityToolNameSchema.safeParse(input.toolName);
      return {
        context,
        bash,
        isCurrent: () => isCurrent() && credentialVersion === credentialEpoch,
        target: JSON.parse(
          JSON.stringify({
            toolConfiguration: selectedTool.success
              ? (settings.tools?.[selectedTool.data] ?? null)
              : null,
            // Only quick_script and extension tools read extension settings; other
            // approvals must not be invalidated by unrelated extension edits.
            ...(quickScript || isExtensionTool
              ? {
                  extensions: extensions.extensions,
                  // Switching an extension's account (or its site) ends approvals.
                  accounts: await selectedAccountsTarget(
                    registry,
                    extensions,
                    accounts,
                  ),
                }
              : {}),
            python:
              input.toolName === "python_exec" && python?.available
                ? python
                : null,
            shellPath: spawnsShell ? (bash.shellPath ?? null) : null,
          }),
        ) as Record<string, unknown>,
      };
    }
  });
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
  const mcpServerNames = new McpServerNames(mcpCatalog);
  const discoveries = new Map<string, Promise<void>>();
  const resourceFingerprint = () =>
    JSON.stringify({
      discoveredSkills: [...discoveredSkills],
      mcpServerNames: mcpServerNames.snapshot(),
      credentialEpoch,
      extensionEpoch,
      modelConfiguration: deps.storage.configuration.providers,
      models: deps.providerCatalog.resolvedModels(),
      nerve: deps.nerveSkills.skills,
      browser: deps.agentBrowserSkills.skills,
      trust: core.trust.generation,
      projects: core.projects.generation,
    });
  const resourceGeneration = resourceGenerationOf(resourceFingerprint);
  const trustLookup = lazyTrust(() => core.trust);
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
    userTrust: userTrustWrites(() => storage),
    agentTrustState: (id, path, digest) =>
      core.trust.state("capabilities", id, path, toTrustedDigest(digest)),
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
    profileTrustState: (projectId, path, digest) =>
      core.trust.state(
        "agent_profile",
        projectId,
        path,
        toTrustedDigest(digest),
      ),
    prepareResources: async (projectId) => {
      await mcpServerNames.refresh(
        projectId,
        storage.projects.get(projectId)!.directory,
      );
      const key = `${projectId}:${storage.projects.get(projectId)!.directory}`;
      let pending = discoveries.get(key);
      if (!pending) {
        pending = discoverFileSkillNames(
          storage.projects.get(projectId)!.directory,
          {
            storageHome: deps.storage.paths.home,
            nerveSkills: deps.nerveSkills.skills,
            agentBrowserSkills: deps.agentBrowserSkills.skills,
          },
        ).then((names) => void discoveredSkills.set(projectId, names));
        discoveries.set(key, pending);
      }
      return pending;
    },
    captureResources: (projectId) => {
      const generation = resourceGeneration();
      const models = deps.providerCatalog.resolvedModels();
      return {
        options: {
          eligibleMcpServers: projectId ? mcpServerNames.get(projectId) : [],
          eligibleSkills: {
            file: projectId ? (discoveredSkills.get(projectId) ?? []) : [],
            nerve: deps.nerveSkills.skills.map((skill) => skill.name),
            agentBrowser: deps.agentBrowserSkills.skills.map(
              (skill) => skill.name,
            ),
          },
          clampThinking: (model, thinking) =>
            clampAgentThinkingLevel(model, thinking, models),
          referenceAvailable: referenceAvailable(models),
        },
        isCurrent: () => generation === resourceGeneration(),
      };
    },
  });
  // A reload changes what the next prepared request sees.
  extensionCatalog.subscribe(() => {
    extensionEpoch++;
    // Consent, the switch and reloads change what every non-conversation view lists.
    void deps.events
      .publish("extensions.changed", { scope: { scope: "user" } })
      .catch((error) => {
        void deps.logger.warn("Extension change notification failed", {
          error,
        });
      });
  });
  const extensionSettings = new ExtensionSettingsService({
    paths: agentConfiguration.paths,
    projectMigration,
    definitions: (projectId) =>
      extensionCatalog.settingsDefinitions(
        projectId ? projectDirectory(projectId) : undefined,
      ),
    projectTrustState: (projectId, path, digest) =>
      core.trust.state(
        "capabilities",
        projectId,
        path,
        toTrustedDigest(digest),
      ),
  });
  extensionSettings.subscribe((scope) => {
    // A conversation's own file is written while that conversation is created
    // (a child's frozen settings), so it cannot invalidate that creation.
    if (scope.scope !== "conversation") extensionEpoch++;
    // Conversation scopes are published too: a conversation's extension view
    // can be open, and a client only reloads views of the scope it shows.
    void deps.events.publish("extensions.changed", { scope }).catch((error) => {
      void deps.logger.warn("Extension change notification failed", {
        error,
      });
    });
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
      hasEnabledMcpServers: (input, settings) =>
        mcp.hasEnabledServers(
          mcpRunOf(input.conversation.projectId, input.projectDir, settings),
        ),
      service: agentConfiguration,
      tools: tools.definitions,
      nerveSkills: () => deps.nerveSkills.skills,
      agentBrowserSkills: () => deps.agentBrowserSkills.skills,
      projectSkillTrust: createProjectSkillTrust(trustLookup),
      hasChildren: (id) =>
        (storage.conversations.getSummary(id)?.childCount ?? 0) > 0,
      registry: (projectDir) => extensionCatalog.registryFor(projectDir),
      models: modelHosts,
      extensionStore: deps.extensionStore,
      extensions: async (id, projectId) => ({
        resolution: await conversationExtensionSettings(id, projectId),
        accounts: deps.accounts.reader(projectId),
      }),
    }),
  });
  const admissionPolicy = createScopedPermissionSource({
    projectMigration,
    home: deps.storage.paths.home,
    storage,
    trust: trustLookup,
    agents: agentConfiguration,
    trustGeneration: () => core.trust.generation + core.projects.generation,
    requestGenerations: (id) => scopedConfiguration.getCapture(id)?.generations,
    registryFor: (projectDirectory) =>
      extensionCatalog.registryFor(projectDirectory),
  });
  const configurationResources = createResourceRegistry({
    home: deps.storage.paths.home,
    mcpCatalog,
    agentConfiguration,
    policy: admissionPolicy,
    trust: trustLookup,
    launchDefinitions: launchServices.definitions,
    extensionCatalog,
    builtinSkills: () => [
      ...deps.nerveSkills.skills,
      ...deps.agentBrowserSkills.skills,
    ],
  });
  const mcpService = createMcpService({
    deps,
    parts: mcpParts,
    core: () => core,
    agentConfiguration,
    projectDirectory,
    invalidate: () => {
      admissionPolicy.invalidate();
      agentConfiguration.invalidateResources();
    },
  });
  const userApproved = (toolCallId: string) => {
    const supervision = storage.toolCalls.get(toolCallId)?.supervision;
    return (
      supervision?.decision === "approval" && Boolean(supervision.approval)
    );
  };
  const authorizeQuickScriptCall = createQuickScriptAuthorizer(
    createExecutionAdmission(admissionPolicy),
    (call) => extensionCatalog.registryFor(call.projectDir),
  );
  const conversationTitles = createConversationTitles(deps, models);
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
    models: modelHosts,
    configurationOperations,
    scopedConfiguration,
    admissionPolicy,
    configurationResources,
    subagentHost,
    mcp,
    mcpService,
  };
}
