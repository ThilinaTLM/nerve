import { GitService, GitWorkflowError } from "@nervekit/host-runtime/tools";
import type { SandboxCommandRouter } from "./command-router.js";
import { SandboxCommandError } from "./errors.js";

const SANDBOX_PROJECT_ID = "sandbox_workspace";

export function registerSandboxGitHandlers(
  router: SandboxCommandRouter,
  workspaceDir = "/workspace",
  publish?: (event: {
    type: "git.repository.changed";
    durability: "durable";
    data: { repo: string; reason: string };
  }) => Promise<unknown>,
): void {
  const git = GitService.forWorkspace(workspaceDir, "workspace");

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GitWorkflowError) {
        throw new SandboxCommandError(error.code, error.message);
      }
      throw error;
    }
  };

  router.register("git.repos.discover", () =>
    run(() => git.discoverRepos(SANDBOX_PROJECT_ID)),
  );
  router.register("git.overview.get", (params) =>
    run(() => git.overview(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("git.branches.list", (params) =>
    run(() => git.listBranches(SANDBOX_PROJECT_ID, repo(params))),
  );
  const mutate = async <T>(
    reason: string,
    params: unknown,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const result = await run(fn);
    await publish?.({
      type: "git.repository.changed",
      durability: "durable",
      data: { repo: repo(params), reason },
    });
    return result;
  };

  router.register("git.branch.create", (params) =>
    mutate("branch.create", params, () =>
      git.createBranch(SANDBOX_PROJECT_ID, repo(params), name(params)),
    ),
  );
  router.register("git.branch.switch", (params) =>
    mutate("branch.switch", params, () =>
      git.switchBranch(SANDBOX_PROJECT_ID, repo(params), name(params)),
    ),
  );
  router.register("git.file.stage", (params) =>
    mutate("file.stage", params, () =>
      git.stageFile(SANDBOX_PROJECT_ID, repo(params), filePath(params)),
    ),
  );
  router.register("git.file.unstage", (params) =>
    mutate("file.unstage", params, () =>
      git.unstageFile(SANDBOX_PROJECT_ID, repo(params), filePath(params)),
    ),
  );
  router.register("git.file.discard", (params) =>
    mutate("file.discard", params, () =>
      git.discardFile(SANDBOX_PROJECT_ID, repo(params), filePath(params)),
    ),
  );
  router.register("git.sync", (params) =>
    mutate("sync", params, () =>
      git.syncBranch(SANDBOX_PROJECT_ID, repo(params)),
    ),
  );
  router.register("git.push", (params) =>
    mutate("push", params, () => git.push(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("git.pull", (params) =>
    mutate("pull", params, () => git.pull(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("git.fetch", (params) =>
    mutate("fetch", params, () => git.fetch(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("git.switchBaseAndPull", (params) =>
    mutate("switch_base_and_pull", params, () =>
      git.switchBaseAndPull(SANDBOX_PROJECT_ID, repo(params)),
    ),
  );
  router.register("github.status.get", (params) =>
    run(() => git.githubStatus(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("github.pr.list", (params) =>
    run(() => git.listOpenPrs(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("github.pr.get", (params) =>
    run(() => git.prDetail(SANDBOX_PROJECT_ID, repo(params), prNumber(params))),
  );
  router.register("github.pr.checkout", (params) =>
    mutate("github.pr.checkout", params, () =>
      git.checkoutPr(SANDBOX_PROJECT_ID, repo(params), prNumber(params)),
    ),
  );
}

function repo(params: unknown): string {
  return record(params).repo as string;
}

function name(params: unknown): string {
  return record(params).name as string;
}

function filePath(params: unknown): string {
  return record(params).path as string;
}

function prNumber(params: unknown): number {
  return record(params).number as number;
}

function record(params: unknown): Record<string, unknown> {
  return params && typeof params === "object" && !Array.isArray(params)
    ? (params as Record<string, unknown>)
    : {};
}
