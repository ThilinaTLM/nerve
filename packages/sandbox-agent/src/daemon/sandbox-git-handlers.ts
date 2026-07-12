import { withGitMutationEvents } from "@nervekit/host-runtime";
import { GitService, GitWorkflowError } from "@nervekit/host-runtime/tools";
import type { SandboxOperationRouter } from "./operation-router.js";
import { SandboxOperationError } from "./errors.js";

const SANDBOX_PROJECT_ID = "sandbox_workspace";

export function registerSandboxGitHandlers(
  router: SandboxOperationRouter,
  workspaceDir = "/workspace",
  publish?: (event: {
    type: "git.repository.changed";
    durability: "durable";
    data: { repo: string; reason: string };
  }) => Promise<unknown>,
): void {
  const git = withGitMutationEvents(
    GitService.forWorkspace(workspaceDir, "workspace"),
    {
      publish: async (type, data) => {
        await publish?.({ type, durability: "durable", data });
      },
    },
  );

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GitWorkflowError) {
        throw new SandboxOperationError(error.code, error.message);
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
  router.register("git.branch.create", (params) =>
    run(() => git.createBranch(SANDBOX_PROJECT_ID, repo(params), name(params))),
  );
  router.register("git.branch.switch", (params) =>
    run(() => git.switchBranch(SANDBOX_PROJECT_ID, repo(params), name(params))),
  );
  router.register("git.file.stage", (params) =>
    run(() =>
      git.stageFile(SANDBOX_PROJECT_ID, repo(params), filePath(params)),
    ),
  );
  router.register("git.file.unstage", (params) =>
    run(() =>
      git.unstageFile(SANDBOX_PROJECT_ID, repo(params), filePath(params)),
    ),
  );
  router.register("git.file.discard", (params) =>
    run(() =>
      git.discardFile(SANDBOX_PROJECT_ID, repo(params), filePath(params)),
    ),
  );
  router.register("git.sync", (params) =>
    run(() => git.syncBranch(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("git.push", (params) =>
    run(() => git.push(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("git.pull", (params) =>
    run(() => git.pull(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("git.fetch", (params) =>
    run(() => git.fetch(SANDBOX_PROJECT_ID, repo(params))),
  );
  router.register("git.switchBaseAndPull", (params) =>
    run(() => git.switchBaseAndPull(SANDBOX_PROJECT_ID, repo(params))),
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
    run(() =>
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
