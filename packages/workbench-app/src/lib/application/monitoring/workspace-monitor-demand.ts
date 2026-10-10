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

type RepositoryDemand = {
  projectId: string;
  repo: string;
  revision: number;
};

export class WorkspaceMonitorDemandCoordinator {
  readonly #projects = new Map<string, ProjectDemand>();
  readonly #repositories = new Map<string, RepositoryDemand>();
  readonly #tails = new Map<string, Promise<void>>();
  readonly #request: ProtocolRequest;
  readonly #isReady: () => boolean;
  #epoch = 0;

  constructor(options: { request: ProtocolRequest; isReady: () => boolean }) {
    this.#request = options.request;
    this.#isReady = options.isReady;
  }

  syncProject(
    projectId: string,
    directories: readonly string[],
  ): Promise<void> {
    const revision = (this.#projects.get(projectId)?.revision ?? 0) + 1;
    this.#projects.set(projectId, { directories: [...directories], revision });
    return this.#deliverProject(projectId, revision, this.#epoch);
  }

  clearProject(projectId: string): Promise<void> {
    const revision = (this.#projects.get(projectId)?.revision ?? 0) + 1;
    this.#projects.delete(projectId);
    return this.#deliverProject(projectId, revision, this.#epoch);
  }

  syncRepository(
    projectId: string,
    repo: string,
    active: boolean,
  ): Promise<void> {
    if (!active) return this.clearRepository(projectId, repo);
    const key = repositoryKey(projectId, repo);
    const revision = (this.#repositories.get(key)?.revision ?? 0) + 1;
    this.#repositories.set(key, { projectId, repo, revision });
    return this.#deliverRepository(key, revision, this.#epoch);
  }

  clearRepository(projectId: string, repo: string): Promise<void> {
    const key = repositoryKey(projectId, repo);
    const revision = (this.#repositories.get(key)?.revision ?? 0) + 1;
    this.#repositories.delete(key);
    return this.#deliverRepository(key, revision, this.#epoch);
  }

  /**
   * Ask the server to re-scan a monitored repository. Runs on the repository's
   * delivery queue, so it always follows this client's own sync for it.
   * Resolves false without a request when this client has no demand for the
   * repository or the live session is not ready (reconcile re-syncs later).
   */
  refreshRepository(projectId: string, repo: string): Promise<boolean> {
    const key = repositoryKey(projectId, repo);
    const epoch = this.#epoch;
    return this.#enqueue(`repository:${key}`, async () => {
      if (epoch !== this.#epoch || !this.#isReady()) return false;
      if (!this.#repositories.has(key)) return false;
      const result = await this.#request("git.repository.refresh", {
        projectId,
        repo,
      });
      return result.active;
    });
  }

  /** Project counterpart of {@link refreshRepository}. */
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
    const deliveries = [
      ...[...this.#projects].map(([projectId, demand]) =>
        this.#deliverProject(projectId, demand.revision, epoch),
      ),
      ...[...this.#repositories].map(([key, demand]) =>
        this.#deliverRepository(key, demand.revision, epoch),
      ),
    ];
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
    this.#repositories.clear();
  }

  #deliverProject(
    projectId: string,
    revision: number,
    epoch: number,
  ): Promise<void> {
    return this.#enqueue(`project:${projectId}`, async () => {
      if (epoch !== this.#epoch || !this.#isReady()) return;
      const demand = this.#projects.get(projectId);
      if (demand && demand.revision !== revision) return;
      if (demand) {
        await this.#request("filesystem.project.monitor.sync", {
          projectId,
          directories: demand.directories,
        });
        return;
      }
      await this.#request("filesystem.project.monitor.clear", { projectId });
    });
  }

  #deliverRepository(
    key: string,
    revision: number,
    epoch: number,
  ): Promise<void> {
    return this.#enqueue(`repository:${key}`, async () => {
      if (epoch !== this.#epoch || !this.#isReady()) return;
      const demand = this.#repositories.get(key);
      if (demand && demand.revision !== revision) return;
      const { projectId, repo } = demand ?? parseRepositoryKey(key);
      if (demand) {
        await this.#request("git.repository.monitor.sync", {
          projectId,
          repo,
          active: true,
        });
        return;
      }
      await this.#request("git.repository.monitor.clear", { projectId, repo });
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

function repositoryKey(projectId: string, repo: string): string {
  return JSON.stringify([projectId, repo]);
}

function parseRepositoryKey(key: string): {
  projectId: string;
  repo: string;
} {
  const [projectId, repo] = JSON.parse(key) as [string, string];
  return { projectId, repo };
}

export const workspaceMonitorDemand = new WorkspaceMonitorDemandCoordinator({
  request: requestWorkbench,
  isReady: isWorkbenchReady,
});
