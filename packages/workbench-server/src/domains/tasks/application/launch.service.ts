import type { TaskLogQuery, TaskRecord } from "@nervekit/contracts/tasks";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { WorkbenchNoticePublisher } from "../../../infrastructure/events/index.js";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";
import {
  createWorkbenchTaskResources,
  type WorkbenchTaskAdapterOptions,
} from "../adapters/workbench-task-adapters.js";
import { isActiveTaskStatus } from "../model/task-status.js";
import { TaskService, type TaskStartInput } from "./task-service.js";

/** User-owned processes: no recovery, documents, or conversation notifications. */
export class LaunchService extends TaskService {
  private readonly resources;
  private closing = false;
  private readonly portPolls = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    storage: InitializedStorage,
    private readonly events: WorkbenchNoticePublisher,
    logger?: ApplicationLogger,
    options: WorkbenchTaskAdapterOptions = {},
  ) {
    const resources = createWorkbenchTaskResources(
      storage,
      events,
      logger,
      options,
    );
    super(resources.ports);
    this.resources = resources;
  }

  override async start(request: TaskStartInput): Promise<TaskRecord> {
    if (this.closing) throw new Error("Launch service is shutting down.");
    const launch = await super.start({
      ...request,
      visibility: "background",
      onOutput: undefined,
    });
    this.schedulePortPoll(launch.id);
    return launch;
  }

  listLaunches(): TaskRecord[] {
    return [...this.resources.tasks.values()].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  async associateDefinition(id: string, definitionId: string): Promise<void> {
    const source = await this.require(id);
    const root = source.restartRootTaskId ?? source.id;
    for (const launch of this.listLaunches()) {
      if ((launch.restartRootTaskId ?? launch.id) !== root) continue;
      const updated = await this.updateLaunch(launch.id, { definitionId });
      await this.events.publish("launch.updated", { task: updated });
    }
  }

  queryLogs(id: string, query: TaskLogQuery = {}) {
    return this.logs(id, query);
  }

  override async delete(id: string): Promise<void> {
    await super.delete(id);
    const timer = this.portPolls.get(id);
    if (timer) clearTimeout(timer);
    this.portPolls.delete(id);
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    for (const timer of this.portPolls.values()) clearTimeout(timer);
    this.portPolls.clear();
    await Promise.allSettled(
      this.listLaunches()
        .filter((launch) => isActiveTaskStatus(launch.status))
        .map((launch) =>
          this.cancel(launch.id, {
            signal: "SIGKILL",
            timeoutMs: 100,
            reason: "daemon_shutdown",
          }),
        ),
    );
  }

  private async updateLaunch(
    id: string,
    patch: Partial<TaskRecord>,
  ): Promise<TaskRecord> {
    const current = this.resources.tasks.get(id);
    if (!current) throw new Error("Launch not found.");
    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    await this.resources.ports.repository.save(current);
    return current;
  }

  private schedulePortPoll(id: string): void {
    if (this.closing) return;
    const timer = setTimeout(() => {
      this.portPolls.delete(id);
      void this.refreshPorts(id)
        .catch(() => undefined)
        .finally(() => {
          const launch = this.resources.tasks.get(id);
          if (launch && isActiveTaskStatus(launch.status))
            this.schedulePortPoll(id);
        });
    }, 1_000);
    timer.unref();
    this.portPolls.set(id, timer);
  }

  private async refreshPorts(id: string): Promise<void> {
    const launch = this.resources.tasks.get(id);
    if (!launch?.runtime || !isActiveTaskStatus(launch.status)) return;
    const ports = await this.resources.supervisor.inspectRuntimeListeningPorts(
      launch.runtime,
    );
    const current = this.resources.tasks.get(id);
    if (!current?.runtime || !isActiveTaskStatus(current.status)) return;
    const key = (items: typeof ports) =>
      items
        .map(
          ({ protocol, address, port, pid }) =>
            `${protocol}:${address}:${port}:${pid}`,
        )
        .sort()
        .join("|");
    if (key(current.runtime.listeningPorts ?? []) === key(ports)) return;
    const updated = await this.updateLaunch(id, {
      runtime: { ...current.runtime, listeningPorts: ports },
    });
    await this.events.publish("launch.runtime_updated", { task: updated });
  }
}
