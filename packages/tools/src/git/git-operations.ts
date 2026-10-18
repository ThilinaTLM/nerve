import { randomUUID } from "node:crypto";
import { inGitLane, inGitCreationLane } from "./git-operation-context.js";
import { safeGitFailure } from "./git-progress.js";
import type { GitService } from "./git-service.js";
import type { GitCommandOptions } from "./git-command.js";
import { GIT_NETWORK_DEADLINE_MS } from "./git-operation-policy.js";
import {
  gitOperationTitle,
  gitBulkOperationTitle,
  type GitOperationStartRequest,
} from "@nervekit/contracts/git";

export interface GitActivityHandle {
  readonly id: string;
  progress(patch: {
    status?: "queued" | "running";
    phase?: string;
    message?: string;
    progress?: { completed: number; total: number };
    cancellable?: boolean;
  }): void;
  succeed(): void;
  fail(error: { message: string; category?: string }): void;
  cancelled(): void;
  interrupt(): void;
}
/** Structural producer port; tools never depends on the server reporting registry. */
export interface GitActivityPort {
  start(
    input: {
      id?: string;
      parentId?: string;
      kind: string;
      title: string;
      scope?: {
        projectId?: string;
        projectName?: string;
        repositoryPath?: string;
      };
      status?: "queued" | "running";
    },
    actions?: { cancel?: () => void | boolean; retry?: () => string },
  ): GitActivityHandle;
}
export type GitOperationRepositoryPort = Pick<
  GitService,
  | "resolveRepoDir"
  | "getProject"
  | "fetch"
  | "pull"
  | "push"
  | "syncBranch"
  | "switchBaseAndPull"
  | "checkoutPr"
  | "clone"
  | "closeRemoteCaches"
>;

export type GitOperationInput = GitOperationStartRequest;
interface Running {
  controller: AbortController;
  settled: Promise<boolean>;
  cancel: () => void | boolean;
}

/** Memory-only producer. Activity owns reporting/retention, never process scheduling. */
export class GitOperationService {
  readonly #running = new Map<string, Running>();
  #closing = false;
  constructor(
    readonly git: GitOperationRepositoryPort,
    readonly activities: GitActivityPort,
    readonly changed: (
      input: GitOperationInput,
    ) => void | Promise<void> = () => {},
    readonly deadlineMs = GIT_NETWORK_DEADLINE_MS,
  ) {}

  start(input: GitOperationInput, parentId?: string): { operationId: string } {
    if (this.#closing) throw new Error("Git operations are shutting down");
    input = structuredClone(input);
    // Validate authorization/containment before acknowledging the operation.
    const cwd = this.git.resolveRepoDir(input.projectId, input.repo);
    if (
      input.kind === "checkout" &&
      (!Number.isSafeInteger(input.number) || input.number <= 0)
    )
      throw new Error("A pull request number is required");
    if (input.kind === "clone" && !input.remoteUrl?.trim())
      throw new Error("A clone remote is required");
    const operationId = `git_${randomUUID()}`;
    const controller = new AbortController();
    const activity = this.activities.start(
      {
        id: operationId,
        parentId,
        kind: `git.${input.kind}`,
        title: gitOperationTitle(input),
        scope: {
          projectId: input.projectId,
          projectName: this.git.getProject(input.projectId).name,
          repositoryPath: input.repo,
        },
        status: "queued",
      },
      {
        cancel: () => this.cancel(operationId).accepted,
        retry: () => this.start(input).operationId,
      },
    );
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const commandOptions: GitCommandOptions = {
      signal: controller.signal,
      activityId: operationId,
      onProgress: ({ phase, completed, total }) =>
        activity.progress({
          phase,
          progress:
            completed !== undefined && total ? { completed, total } : undefined,
        }),
    };
    const lane = input.kind === "clone" ? inGitCreationLane : inGitLane;
    const settled = lane(
      cwd,
      true,
      async () => {
        controller.signal.throwIfAborted();
        commandOptions.deadlineAt = performance.now() + this.deadlineMs;
        deadline = setTimeout(() => {
          controller.abort(
            new DOMException("Git operation timed out", "TimeoutError"),
          );
          activity.progress({ cancellable: false });
        }, this.deadlineMs);
        activity.progress({
          status: "running",
          message: ["push", "sync"].includes(input.kind)
            ? "Cancelling may not undo remote updates."
            : undefined,
        });
        switch (input.kind) {
          case "fetch":
            await this.git.fetch(input.projectId, input.repo);
            break;
          case "pull":
            await this.git.pull(input.projectId, input.repo);
            break;
          case "push":
            await this.git.push(input.projectId, input.repo);
            break;
          case "sync":
            await this.git.syncBranch(input.projectId, input.repo);
            break;
          case "switchBaseAndPull":
            await this.git.switchBaseAndPull(
              input.projectId,
              input.repo,
              input.baseBranch,
            );
            break;
          case "checkout":
            await this.git.checkoutPr(
              input.projectId,
              input.repo,
              input.number,
            );
            break;
          case "clone":
            await this.git.clone(input.projectId, input.repo, input.remoteUrl);
            break;
        }
        // Refresh on success even if cancellation raced with a successful durable mutation.
        try {
          await this.changed(input);
        } catch {
          /* Reporting cannot change the mutation outcome. */
        }
      },
      commandOptions,
    )
      .then(
        () => {
          this.#running.delete(operationId);
          activity.succeed();
          return true;
        },
        (error: unknown) => {
          this.#running.delete(operationId);
          if (this.#closing) activity.interrupt();
          else if (
            controller.signal.aborted &&
            (controller.signal.reason as Error)?.name === "TimeoutError"
          )
            activity.fail({
              category: "timeout",
              message:
                "Git operation exceeded its total deadline. Review repository state before retrying.",
            });
          else if (controller.signal.aborted) activity.cancelled();
          else activity.fail(safeGitFailure(error));
          return false;
        },
      )
      .finally(() => {
        clearTimeout(deadline);
        this.#running.delete(operationId);
      });
    this.#running.set(operationId, {
      controller,
      settled,
      cancel: () => {
        controller.abort();
        activity.progress({ cancellable: false });
      },
    });
    return { operationId };
  }

  startBulk(input: {
    projectId: string;
    repos: string[];
    kind: "fetch" | "pull";
  }): { operationId: string; childOperationIds: string[] } {
    if (this.#closing) throw new Error("Git operations are shutting down");
    input = structuredClone(input);
    const repos = [...new Set(input.repos)];
    if (!repos.length || repos.length > 100)
      throw new Error("Bulk Git operations are limited to 100 repositories");
    for (const repo of repos) this.git.resolveRepoDir(input.projectId, repo);
    const operationId = `git_${randomUUID()}`;
    const controller = new AbortController();
    const childOperationIds: string[] = [];
    const parent = this.activities.start(
      {
        id: operationId,
        kind: `git.${input.kind}.all`,
        title: gitBulkOperationTitle(input.kind),
        scope: {
          projectId: input.projectId,
          projectName: this.git.getProject(input.projectId).name,
        },
        status: "running",
      },
      {
        cancel: () => this.cancel(operationId).accepted,
        retry: () => this.startBulk(input).operationId,
      },
    );
    const children = repos.map((repo) => {
      try {
        const child = this.start({ ...input, repo }, operationId);
        childOperationIds.push(child.operationId);
        return this.#running.get(child.operationId)!.settled;
      } catch {
        const failed = this.activities.start({
          parentId: operationId,
          kind: `git.${input.kind}`,
          title: gitOperationTitle({ kind: input.kind, repo }),
          scope: { projectId: input.projectId, repositoryPath: repo },
        });
        failed.fail(safeGitFailure(undefined));
        childOperationIds.push(failed.id);
        return Promise.resolve(false);
      }
    });
    let completed = 0;
    const settled = Promise.all(
      children.map((child) =>
        child.then((ok) => {
          completed++;
          if (repos.length)
            parent.progress({ progress: { completed, total: repos.length } });
          return ok;
        }),
      ),
    )
      .then((results) => {
        this.#running.delete(operationId);
        return this.finishParent(parent, results, controller.signal);
      })
      .finally(() => {
        this.#running.delete(operationId);
      });
    this.#running.set(operationId, {
      controller,
      settled,
      cancel: () => {
        const children = childOperationIds.flatMap((id) => {
          const child = this.#running.get(id);
          return child ? [child] : [];
        });
        if (!children.length) return false;
        controller.abort();
        parent.progress({ cancellable: false });
        for (const child of children) child.cancel();
      },
    });
    return { operationId, childOperationIds };
  }

  private finishParent(
    parent: GitActivityHandle,
    results: boolean[],
    signal: AbortSignal,
  ): boolean {
    if (results.every(Boolean)) parent.succeed();
    else if (this.#closing) parent.interrupt();
    else if (signal.aborted) parent.cancelled();
    else
      parent.fail({
        category: "partial_failure",
        message: "Some repositories failed. Review the individual results.",
      });
    return results.every(Boolean);
  }
  cancel(operationId: string): { accepted: boolean; reason?: string } {
    const operation = this.#running.get(operationId);
    if (!operation || this.#closing || operation.controller.signal.aborted)
      return {
        accepted: false,
        reason: "Git operation is no longer cancellable.",
      };
    if (operation.cancel() === false)
      return {
        accepted: false,
        reason: "Git operation is no longer cancellable.",
      };
    return { accepted: true };
  }

  async close(): Promise<void> {
    this.#closing = true;
    const entries = [...this.#running.values()];
    for (const entry of entries) entry.cancel();
    const caches = this.git.closeRemoteCaches();
    await Promise.all([caches, ...entries.map((entry) => entry.settled)]);
  }
}
