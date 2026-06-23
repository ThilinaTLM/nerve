import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  createId,
  type StartTaskRequest,
  type TaskRecord,
} from "@nerve/shared";
import type { ToolExecutionOutputUpdate } from "@nerve/tools";
import { createTaskLogCursor } from "./index.js";
import type { ManagedTask, TaskManager } from "./task-manager.js";
import {
  buildTaskEnvInfo,
  defaultTaskNotificationsEnabled,
} from "./task-manager-utils.js";

export async function startTask(
  this: TaskManager,
  request: StartTaskRequest & {
    restartedFromTaskId?: string;
    workerId?: string;
    origin?: TaskRecord["origin"];
    completion?: TaskRecord["completion"];
    visibility?: TaskRecord["visibility"];
    onOutput?: (update: ToolExecutionOutputUpdate) => void;
  },
): Promise<TaskRecord> {
  const now = new Date().toISOString();
  const id = createId("task");
  const dir = this.taskDir(id);
  await mkdir(dir, { recursive: true, mode: 0o755 });

  const envInfo = buildTaskEnvInfo(request.env);
  if (envInfo) {
    await this.launchConfigs.write(id, {
      version: 1,
      env: request.env,
      createdAt: now,
      updatedAt: now,
    });
  }

  const readiness = this.taskReadiness.buildReadiness(request);
  const notify = defaultTaskNotificationsEnabled(request);
  const injectCompletion = request.injectCompletion ?? false;
  const restartSource = request.restartedFromTaskId
    ? this.tasks.get(request.restartedFromTaskId)
    : undefined;
  const restartRootTaskId = restartSource
    ? (restartSource.restartRootTaskId ?? restartSource.id)
    : request.restartedFromTaskId
      ? request.restartedFromTaskId
      : id;
  const restartGeneration = restartSource
    ? (restartSource.restartGeneration ?? 0) + 1
    : request.restartedFromTaskId
      ? 1
      : 0;
  const completion =
    request.completion ??
    (injectCompletion
      ? { inject: true, outputTailLineCount: 80 }
      : request.injectCompletion === false
        ? { inject: false, outputTailLineCount: 80 }
        : undefined);
  const notifications = {
    enabled: notify,
    ready: notify,
    terminal: notify,
    outputTailLineCount: 80,
  };
  const record: TaskRecord = {
    id,
    name: request.name,
    groupId: request.groupId,
    groupName: request.groupName,
    workerId: request.workerId,
    projectId: request.projectId,
    conversationId: request.conversationId,
    agentId: request.agentId,
    cwd: resolve(request.cwd),
    command: request.command,
    envInfo,
    status: "starting",
    readiness,
    stdoutPath: join(dir, "stdout.log"),
    stderrPath: join(dir, "stderr.log"),
    combinedPath: join(dir, "combined.log"),
    logsPath: join(dir, "logs.jsonl"),
    startedAt: now,
    updatedAt: now,
    timeoutMs: request.timeoutMs,
    restartedFromTaskId: request.restartedFromTaskId,
    restartRootTaskId,
    restartGeneration,
    origin: request.origin ?? { kind: "api" },
    completion,
    notifications,
    visibility: request.visibility ?? "background",
  };

  const readinessPattern = this.taskReadiness.compilePattern(
    request.readyPattern,
  );

  await this.upsertTask(record);
  await this.events.publish("task.created", { task: record });
  await this.logger?.info("Task created", {
    taskId: record.id,
    projectId: record.projectId,
    conversationId: record.conversationId,
    agentId: record.agentId,
    context: {
      name: record.name,
      cwd: record.cwd,
      command: record.command,
      envKeyCount: record.envInfo?.keys.length ?? 0,
    },
  });

  const spawned = this.supervisor.spawn(request.command, {
    cwd: record.cwd,
    env: request.env,
  });
  const { child, runtime } = spawned;
  await this.updateTask(record.id, { runtime });

  const closePromise = new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveClose) => {
    child.once("close", (exitCode, signal) => {
      resolveClose({ exitCode, signal });
    });
  });
  let resolveTerminal: ((task: TaskRecord | undefined) => void) | undefined;
  const terminalPromise = new Promise<TaskRecord | undefined>((resolve) => {
    resolveTerminal = resolve;
  });
  const managed: ManagedTask = {
    child,
    ...createTaskLogCursor(await this.taskLogs.latestLogSeq(record.logsPath)),
    stopping: false,
    finalized: false,
    closePromise,
    terminalPromise,
    resolveTerminal,
    readinessPattern,
    onOutput: request.onOutput,
  };
  managed.finalizationPromise = closePromise
    .then(({ exitCode, signal }) =>
      this.markTaskExited(record.id, exitCode, signal),
    )
    .catch(async (error: unknown) => {
      if (this.logger) {
        await this.logger
          .error("Task finalization failed", {
            taskId: record.id,
            projectId: record.projectId,
            conversationId: record.conversationId,
            agentId: record.agentId,
            error,
          })
          .catch(() => undefined);
      }
      return undefined;
    });
  this.managed.set(record.id, managed);

  child.stdout?.on("data", (chunk) => {
    void this.captureOutput(record.id, "stdout", chunk);
  });
  child.stderr?.on("data", (chunk) => {
    void this.captureOutput(record.id, "stderr", chunk);
  });
  child.on("error", (error) => {
    void this.markTaskError(record.id, error.message);
  });

  await this.updateTask(record.id, { status: "running" });
  this.scheduleReadyUrlPolling(record.id);
  this.scheduleReadinessTimeout(record.id);
  this.scheduleRuntimeTimeout(record.id, request.timeoutMs);
  await this.events.publish("task.started", {
    task: this.getTask(record.id),
    pid: runtime.childPid,
    runtime,
  });
  await this.logger?.info("Task started", {
    taskId: record.id,
    projectId: record.projectId,
    conversationId: record.conversationId,
    agentId: record.agentId,
    context: {
      pid: runtime.childPid,
      processGroupId: runtime.processGroupId,
      platform: runtime.platform,
    },
  });

  return this.getTask(record.id);
}
