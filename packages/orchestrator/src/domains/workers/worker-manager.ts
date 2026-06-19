import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createId,
  type StartTaskRequest,
  type TaskRecord,
  type WorkerRecord,
  workerRecordSchema,
} from "@nerve/shared";
import type { EventBus } from "../../infrastructure/events/index.js";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import {
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  readJsonFile,
} from "../../infrastructure/storage/index.js";
import type { TaskManager } from "../tasks/task-manager.js";
import {
  type AgentProcessHandlers,
  type AgentProcessInput,
  type AgentProcessRun,
  launchAgentProcess as launchLocalAgentProcess,
} from "./agent-process.js";

export class WorkerManager {
  readonly workers = new Map<string, WorkerRecord>();

  constructor(
    private readonly storage: InitializedStorage,
    private readonly events: EventBus,
    private readonly index: IndexStore,
  ) {}

  async hydrate(): Promise<void> {
    const root = join(this.storage.paths.home, "workers");
    for (const workerId of await listChildDirs(root)) {
      const parsed = workerRecordSchema.safeParse(
        await readJsonFile<unknown>(join(root, workerId, "worker.json")).catch(
          () => undefined,
        ),
      );
      if (!parsed.success) continue;
      const worker =
        parsed.data.kind === "local"
          ? this.onlineLocalWorker(parsed.data)
          : parsed.data;
      this.workers.set(worker.id, worker);
      this.index.upsertWorker(worker);
      if (worker !== parsed.data) await this.writeWorker(worker);
    }

    if (!this.defaultLocalWorker()) {
      await this.createLocalWorker();
    }
  }

  listWorkers(): WorkerRecord[] {
    return [...this.workers.values()].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  getWorker(workerId: string): WorkerRecord {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error("Worker not found.");
    return worker;
  }

  defaultLocalWorker(): WorkerRecord | undefined {
    return this.listWorkers().find((worker) => worker.kind === "local");
  }

  requireWorker(workerId: string | undefined, capability: "agent" | "task") {
    const worker = workerId
      ? this.getWorker(workerId)
      : this.requireDefaultLocalWorker();
    if (worker.status !== "online") {
      throw new Error(`Worker ${worker.id} is ${worker.status}.`);
    }
    if (!worker.capabilities.includes(capability)) {
      throw new Error(`Worker ${worker.id} does not support ${capability}.`);
    }
    if (worker.kind !== "local") {
      throw new Error(`Unsupported worker kind: ${worker.kind}.`);
    }
    return worker;
  }

  requireDefaultLocalWorker(): WorkerRecord {
    const worker = this.defaultLocalWorker();
    if (!worker) throw new Error("Local worker is not initialized.");
    return worker;
  }

  launchAgentProcess(
    workerId: string | undefined,
    input: AgentProcessInput,
    handlers: AgentProcessHandlers = {},
  ): AgentProcessRun {
    const worker = this.requireWorker(workerId, "agent");
    return launchLocalAgentProcess(
      { ...input, workerId: worker.id },
      {
        onStarted: async () => {
          await this.events.publish("worker.agent_started", {
            workerId: worker.id,
            runId: input.runId,
          });
          await handlers.onStarted?.();
        },
        onTextDelta: handlers.onTextDelta,
      },
    );
  }

  startTask(
    workerId: string | undefined,
    taskManager: TaskManager,
    request: StartTaskRequest,
  ): Promise<TaskRecord> {
    const worker = this.requireWorker(workerId ?? request.workerId, "task");
    return taskManager.startTask({ ...request, workerId: worker.id });
  }

  private async createLocalWorker(): Promise<WorkerRecord> {
    const now = new Date().toISOString();
    const worker: WorkerRecord = {
      id: createId("worker"),
      kind: "local",
      name: "Local worker",
      status: "online",
      capabilities: ["agent", "task"],
      endpoint: { pid: process.pid },
      createdAt: now,
      updatedAt: now,
    };
    this.workers.set(worker.id, worker);
    this.index.upsertWorker(worker);
    await this.writeWorker(worker);
    await this.events.publish("worker.created", { worker });
    return worker;
  }

  private onlineLocalWorker(worker: WorkerRecord): WorkerRecord {
    return {
      ...worker,
      status: "online",
      endpoint: { ...(worker.endpoint ?? {}), pid: process.pid },
      updatedAt: new Date().toISOString(),
    };
  }

  private async writeWorker(worker: WorkerRecord): Promise<void> {
    const dir = join(this.storage.paths.home, "workers", worker.id);
    await mkdir(dir, { recursive: true, mode: 0o755 });
    await atomicWriteJson(join(dir, "worker.json"), worker, 0o600);
  }
}
