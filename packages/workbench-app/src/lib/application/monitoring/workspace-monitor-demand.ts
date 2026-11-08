import type { FilesystemProjectMonitorState } from "@nervekit/contracts/filesystem";
import type {
  OperationName,
  OperationParams,
  OperationResult,
} from "@nervekit/contracts/operations";
import {
  isWorkbenchReady,
  requestWorkbench,
} from "$lib/application/startup/workbench-connection";

type ProtocolRequest = <M extends OperationName>(
  method: M,
  params: OperationParams<M>,
) => Promise<OperationResult<M>>;

type ProjectDemand = {
  directories: string[];
  revision: number;
};

export class WorkspaceMonitorDemandCoordinator {
  readonly #projects = new Map<string, ProjectDemand>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #request: ProtocolRequest;
  readonly #isReady: () => boolean;
  #epoch = 0;

  constructor(options: { request: ProtocolRequest; isReady: () => boolean }) {
    this.#request = options.request;
    this.#isReady = options.isReady;
  }

  /**
   * Resolves with the server monitor state, or undefined when the delivery was
   * skipped (superseded by newer demand or the session is not ready).
   */
  syncProject(
    projectId: string,
    directories: readonly string[],
  ): Promise<FilesystemProjectMonitorState | undefined> {
    const revision = (this.#projects.get(projectId)?.revision ?? 0) + 1;
    this.#projects.set(projectId, { directories: [...directories], revision });
    return this.#deliverProject(projectId, revision, this.#epoch);
  }

  async clearProject(projectId: string): Promise<void> {
    const revision = (this.#projects.get(projectId)?.revision ?? 0) + 1;
    this.#projects.delete(projectId);
    await this.#deliverProject(projectId, revision, this.#epoch);
  }

  /**
   * Ask the server to re-scan a monitored project. Runs on the project's
   * delivery queue, so it always follows this client's own sync for it.
   * Resolves false without a request when this client has no demand for the
   * project or the live session is not ready (reconcile re-syncs later).
   */
  refreshProject(projectId: string): Promise<boolean> {
    const epoch = this.#epoch;
    return this.#enqueue(`project:${projectId}`, async () => {
      if (epoch !== this.#epoch || !this.#isReady()) return false;
      if (!this.#projects.has(projectId)) return false;
      const result = await this.#request("filesystem.project.refresh", {
        projectId,
      });
      return result.active;
    });
  }

  async reconcile(): Promise<void> {
    const epoch = this.#epoch;
    const deliveries = [...this.#projects].map(([projectId, demand]) =>
      this.#deliverProject(projectId, demand.revision, epoch),
    );
    const settled = await Promise.allSettled(deliveries);
    const failures = settled.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Could not restore workspace monitors",
      );
    }
  }

  reset(): void {
    this.#epoch += 1;
    this.#projects.clear();
  }

  #deliverProject(
    projectId: string,
    revision: number,
    epoch: number,
  ): Promise<FilesystemProjectMonitorState | undefined> {
    return this.#enqueue(`project:${projectId}`, async () => {
      if (epoch !== this.#epoch || !this.#isReady()) return undefined;
      const demand = this.#projects.get(projectId);
      if (demand && demand.revision !== revision) return undefined;
      if (demand) {
        return await this.#request("filesystem.project.monitor.sync", {
          projectId,
          directories: demand.directories,
        });
      }
      await this.#request("filesystem.project.monitor.clear", { projectId });
      return undefined;
    });
  }

  #enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.#tails.set(key, tail);
    void tail.finally(() => {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    });
    return result;
  }
}

export const workspaceMonitorDemand = new WorkspaceMonitorDemandCoordinator({
  request: requestWorkbench,
  isReady: isWorkbenchReady,
});
