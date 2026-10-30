import { ProjectMigrationService } from "../../infrastructure/configuration/project-migration/project-migration.js";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { LaunchService } from "../../domains/launches/application/launch.service.js";
import { LaunchDefinitionService } from "../../domains/launch-definitions/launch-definition.service.js";
import { LaunchDefinitionRepository } from "../../domains/launch-definitions/launch-definition.repository.js";
import { createWorkbenchLaunchResources } from "../../domains/launches/adapters/workbench-launch-adapters.js";
import type {
  LaunchSupervisor,
  SpawnManagedLaunchOptions,
  ProcessLifecycleResult,
} from "../../domains/launches/application/launch-supervisor.js";
import type { InitializedStorage } from "../../infrastructure/storage-bootstrap/index.js";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import type { BackgroundProcess } from "@nervekit/conversation-core";
import { createConversationCore } from "../../app/bootstrap/create-conversation-core.js";
import type { RuntimeDeps } from "../../app/bootstrap/create-runtime-services.js";
import { WorkbenchNoticePublisher } from "../../infrastructure/events/index.js";
import {
  initializeHomeConfiguration,
  readHomeConfiguration,
  settingsFromConfiguration,
} from "../../infrastructure/configuration/home-configuration.js";
import { storagePaths } from "../../infrastructure/storage-bootstrap/paths.js";
import type { CoreProcessHost } from "../process.adapter.js";

type Runtime = ReturnType<typeof createConversationCore>;
export interface ProductionAdmissionFixture {
  home: string;
  project: string;
  paths: ReturnType<typeof storagePaths>;
  spawns: Parameters<CoreProcessHost["spawn"]>[0][];
  readonly runtime: Runtime;
  launches: LaunchService;
  definitions: LaunchDefinitionService;
  launchSpawns: { command: string; options: SpawnManagedLaunchOptions }[];
  events: WorkbenchNoticePublisher;
  settings: InitializedStorage["settings"];
  command(
    command?: string,
    conversationId?: string,
  ): Promise<Awaited<ReturnType<Runtime["core"]["submitInput"]>>>;
  save(changes: LeadSettingsOverrides): Promise<unknown>;
  restartWithShell(shellPath: string): Promise<void>;
  createChild(): Promise<void>;
}

/** Real composition, scoped documents, policy source, repositories and prepared host dispatch.
 * Only external process execution/LLM facilities are replaced; no admission decisions are mocked. */
export async function productionAdmissionFixture(
  t: TestContext,
  steps?: Parameters<typeof registerAgentScriptedProvider>[0]["steps"],
): Promise<ProductionAdmissionFixture> {
  const home = await mkdtemp(join(tmpdir(), "nerve-production-admission-"));
  const project = join(home, "project");
  await mkdir(project);
  const paths = storagePaths(home);
  await mkdir(paths.configPath, { recursive: true });
  await initializeHomeConfiguration(paths);
  const configuration = await readHomeConfiguration(paths);
  const settings = settingsFromConfiguration(configuration);
  // This runtime fixture starts in the current scoped format, not the unshipped
  // harness-v4 format still emitted by the legacy settings projection helper.
  await rm(join(paths.configPath, "harness.json"), { force: true });
  await writeFile(
    join(paths.configPath, "conversation-defaults.json"),
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      overrides: { defaultAgentProfile: "coding" },
    }),
  );
  const providerId = `admission-${randomUUID()}`;
  const provider = registerAgentScriptedProvider({
    provider: providerId,
    model: "test",
    steps: steps ?? [{ type: "waitForAbort" }],
  });
  await mkdir(join(paths.dataPath, "agent-profiles"), { recursive: true });
  await writeFile(
    join(paths.dataPath, "agent-profiles", "worker.json"),
    JSON.stringify({
      schemaVersion: 1,
      name: "worker",
      whenToUse: "Worker",
      usableBy: "subagent",
      instructions: "Work independently.",
      requirements: { permissionRuleSetId: "read_only" },
    }),
  );
  const spawns: Parameters<CoreProcessHost["spawn"]>[0][] = [];
  const spawn = async (
    input: Parameters<CoreProcessHost["spawn"]>[0],
  ): Promise<BackgroundProcess> => {
    if (!input.preparedShell)
      throw new Error("Dispatch did not supply an admitted process target");
    spawns.push({
      ...input,
      preparedShell: structuredClone(input.preparedShell),
    });
    await mkdir(input.artifactDir, { recursive: true });
    const stdout = join(input.artifactDir, "stdout.txt");
    const stderr = join(input.artifactDir, "stderr.txt");
    const combined = join(input.artifactDir, "output.txt");
    await Promise.all([
      writeFile(stdout, "done"),
      writeFile(stderr, ""),
      writeFile(combined, "done"),
    ]);
    return {
      ref: randomUUID(),
      launch: input.preparedShell.invocation.launch,
      outputFiles: { stdout, stderr, combined },
      wait: async () => ({ exitCode: 0, status: "completed" }),
      cancel: async () => {},
    };
  };
  const processHost = {
    spawn,
    start: async (input: Parameters<CoreProcessHost["start"]>[0]) => ({
      process: await spawn(input),
    }),
    reattach: async () => null,
  } as unknown as CoreProcessHost;
  const events = new WorkbenchNoticePublisher();
  const initialized = {
    paths,
    settings,
    configuration,
    localToken: "fixture",
    timings: {},
  } as InitializedStorage;
  const launchSpawns: ProductionAdmissionFixture["launchSpawns"] = [];
  const finishes = new Map<ChildProcess, () => void>();
  const supervisor: LaunchSupervisor = {
    spawn(command, options) {
      if (!options.preparedShell)
        throw new Error(
          "Launch dispatch did not supply an admitted process target",
        );
      launchSpawns.push({ command, options: structuredClone(options) });
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      }) as unknown as ChildProcess;
      let finish!: (result: ProcessLifecycleResult) => void;
      const closed = new Promise<ProcessLifecycleResult>((resolve) => {
        finish = resolve;
      });
      finishes.set(child, () => {
        child.stdout!.destroy();
        child.stderr!.destroy();
        finish({ kind: "closed", exitCode: 0, signal: null });
      });
      return {
        child,
        exited: closed,
        closed,
        runtime: Promise.resolve({
          version: 2 as const,
          platform: process.platform,
          childPid: 123,
          detached: true,
          shell: true,
          containment: "process-group" as const,
          spawnedAt: new Date().toISOString(),
          identity: { kind: "linux" as const, startTimeTicks: 1 },
          capabilities: {
            identity: true,
            processTree: true,
            listeningPorts: true,
            detail: "fixture",
          },
        }),
      };
    },
    terminate: async (child) => {
      finishes.get(child)?.();
      return { attempted: true, terminated: true, method: "none" };
    },
    terminateRuntime: async () => {
      throw new Error("Unexpected detached process");
    },
    isRuntimeTargetAlive: async () => true,
    inspectRuntimeListeningPorts: async () => [],
    inspectPortListeners: async () => [],
    inspectConfiguredPort: async () => [],
    terminateConfiguredPortListener: async () => {
      throw new Error("Unexpected port conflict");
    },
  };
  const launchResources = createWorkbenchLaunchResources(
    initialized,
    events,
    undefined,
    { supervisor },
  );
  const launches = new LaunchService(launchResources);
  let runtime: Runtime;
  const getProject = (id: string) => {
    const value = runtime.core.projects.get(id);
    if (!value) throw new Error("Project not found");
    return value;
  };
  const definitions = new LaunchDefinitionService(
    new LaunchDefinitionRepository(
      getProject,
      new ProjectMigrationService({ home }),
    ),
    getProject,
  );
  const create = (): Runtime =>
    createConversationCore(
      {
        storage: initialized,
        events,
        auth: { requestAuthForPiModel: async () => ({ apiKey: "fixture" }) },
        secrets: {},
        providerCatalog: {
          resolvedModels: () => [],
          resolvedModelsWithCredentials: async () => [],
        },
        logger: { warn: async () => {} },
        nerveSkills: { skills: [] },
        agentBrowserSkills: { skills: [] },
      } as unknown as RuntimeDeps,
      { launches, definitions },
      undefined,
      processHost,
    );
  runtime = create();
  await runtime.agentConfiguration.initialize();
  await writeFile(
    join(paths.configPath, "agent.json"),
    JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      overrides: {
        model: { provider: providerId, modelId: "test" },
        permissionRuleSetId: "autonomous",
        reasoningLevel: "off",
        tools: {
          bash: { settings: { shellPath: "/bin/sh" } },
          subagents: { enabled: true },
        },
        subagents: { worker: { enabled: true } },
      },
    }),
  );
  await runtime.agentConfiguration.reload({ scope: "user" });
  const defaults = await runtime.agentConfiguration.loadCreation({
    scope: "user",
  });
  if (defaults.status === "unavailable")
    throw new Error("Fixture creation preferences unavailable");
  await runtime.agentConfiguration.saveCreation(
    { scope: "user" },
    {
      expectedRevision: defaults.value.revision,
      expectedDigest: defaults.value.digest,
      changes: { defaultAgentProfile: "coding" },
      resets: [],
    },
  );
  runtime.core.projects.create({
    id: "proj_admission",
    name: "Project",
    directory: project,
  });
  await runtime.core.createConversation({
    id: "c",
    projectId: "proj_admission",
  });
  t.after(async () => {
    await launches.shutdown();
    await Promise.all(
      [...launchResources.managed.values()].flatMap((state) =>
        state.finalizationPromise ? [state.finalizationPromise] : [],
      ),
    );
    await runtime.core.close();
    provider.unregister();
    await rm(home, { recursive: true, force: true });
  });
  return {
    home,
    project,
    paths,
    spawns,
    launches,
    definitions,
    launchSpawns,
    events,
    settings,
    get runtime() {
      return runtime;
    },
    command: async (command = "echo test", conversationId = "c") =>
      runtime.core.submitInput({
        conversationId,
        inputId: randomUUID(),
        text: `!${command}`,
        source: "user",
      }),
    save: async (changes: LeadSettingsOverrides) => {
      const state = await runtime.agentConfiguration.ensureLoaded({
        scope: "conversation",
        conversationId: "c",
      });
      if (state.status === "unavailable")
        throw new Error("Expected conversation configuration");
      return runtime.agentConfiguration.save(state.value.scope, {
        expectedRevision: state.value.revision,
        expectedDigest: state.value.digest,
        changes,
        resets: [],
      });
    },
    restartWithShell: async (shellPath: string) => {
      await runtime.core.close();
      const path = join(paths.conversationsPath, "c", "config", "agent.json");
      const document = JSON.parse(await readFile(path, "utf8"));
      document.revision++;
      document.overrides.tools = { bash: { settings: { shellPath } } };
      await writeFile(path, JSON.stringify(document));
      runtime = create();
      await runtime.agentConfiguration.initialize();
      await runtime.core.start();
    },
    createChild: async () => {
      const selected = await runtime.subagentHost.resolveProfile({
        parentId: "c",
        profile: "worker",
      });
      await runtime.core.createConversation({
        id: "child",
        projectId: "proj_admission",
        parentConversationId: "c",
        application: selected.application,
      });
    },
  };
}

export async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for admission lifecycle");
}
