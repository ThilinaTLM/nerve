import {
  summarizeDemands,
  type GitWorkspaceDemandRegistry,
} from "./git-workspace-sync-policy.js";
import type { ProjectEntry } from "./git-workspace-sync-state.js";
import type {
  GitWorkspaceMonitorPort,
  GitWorkspaceReadBackend,
} from "./git-workspace-sync-service.js";

/**
 * Mirrors each connection's workspace demand into native change-monitor
 * watches (one replace-all call per owner and project) and records which
 * repository scopes the monitor cannot watch reliably.
 */
export class MonitorDemandSync {
  readonly #signatures = new Map<string, string>();
  readonly #tail = new Map<string, Promise<unknown>>();

  constructor(
    readonly backend: Pick<GitWorkspaceReadBackend, "resolveRepoDir">,
    readonly monitor: GitWorkspaceMonitorPort | undefined,
    readonly demands: GitWorkspaceDemandRegistry,
    readonly onSettled: () => void,
  ) {}

  /** Forget what was sent for an owner (optionally one project). */
  forget(owner: string, projectId?: string) {
    for (const key of [...this.#signatures.keys()])
      if (
        projectId === undefined
          ? key.startsWith(`${owner}\0`)
          : key === `${owner}\0${projectId}`
      )
        this.#signatures.delete(key);
  }

  /** Resolves to whether any scope of the project is degraded. */
  sync(project: ProjectEntry): Promise<boolean> {
    const monitor = this.monitor;
    if (!monitor) return Promise.resolve(false);
    const projectId = project.projectId;
    const run = async () => {
      let anyDegraded = false;
      for (const owner of this.demands.ownersOf(projectId)) {
        const demand = summarizeDemands(
          [this.demands.owners.get(owner)?.get(projectId)].filter(
            (value) => value !== undefined,
          ),
        );
        const repos = new Set<string>([...demand.details, ...demand.hints]);
        if (demand.visible)
          for (const [repo, entry] of project.repos)
            if (entry.summary) repos.add(repo);
        const targets: Array<{ repo: string; repoDir: string }> = [];
        for (const repo of repos) {
          try {
            targets.push({
              repo,
              repoDir: this.backend.resolveRepoDir(projectId, repo),
            });
          } catch {
            const entry = project.repos.get(repo);
            if (entry) entry.degraded = true;
            anyDegraded = true;
          }
        }
        const signature = JSON.stringify(targets.map((t) => t.repo).sort());
        const ownerKey = `${owner}\0${projectId}`;
        if (this.#signatures.get(ownerKey) === signature) {
          anyDegraded ||= targets.some(
            (t) => project.repos.get(t.repo)?.degraded,
          );
          continue;
        }
        try {
          const states = await monitor.setRepositories(
            owner,
            projectId,
            targets,
          );
          this.#signatures.set(ownerKey, signature);
          for (const target of targets) {
            const state = states.get(target.repo);
            const entry = project.repos.get(target.repo);
            // Inactive means the monitor is not watching it: poll slowly.
            const degraded = !state || state.degraded;
            if (entry) entry.degraded = degraded;
            anyDegraded ||= degraded;
          }
        } catch {
          for (const target of targets) {
            const entry = project.repos.get(target.repo);
            if (entry) entry.degraded = true;
          }
          anyDegraded = true;
        }
      }
      this.onSettled();
      return anyDegraded;
    };
    const previous = this.#tail.get(projectId) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.#tail.set(
      projectId,
      next.catch(() => undefined),
    );
    return next;
  }
}
