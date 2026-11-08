import {
  gitOperationStartRequestSchema,
  type GitMutationResponse,
  type GithubPrListFilters,
} from "@nervekit/contracts/git";
import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../contexts.js";

type GitMethodContext = ServerAdapterContexts["protocol"]["git"];
const defineGitMethodHandlers =
  defineWorkbenchMethodHandlersFor<GitMethodContext>();

export const gitMethodHandlers: WorkbenchMethodHandlerMapFor<GitMethodContext> =
  defineGitMethodHandlers({
    "git.operation.cancel": (state, params) =>
      state.gitOperations.cancel(params.operationId),
    "git.operation.start": (state, params) =>
      state.gitOperations.start(gitOperationStartRequestSchema.parse(params)),
    "git.operation.bulk.start": (state, params) =>
      state.gitOperations.startBulk(params),
    "github.issue.list": (state, params) =>
      state.git.listIssues(params.projectId, repo(params), params.refresh),
    "github.pr.cached.list": (state, params) =>
      state.prSync.cachedOpenPrs(
        params.projectId,
        repo(params),
        params.refresh,
      ),
    "git.workspace.watch.sync": (state, params, invocation) =>
      state.workspaceSync.sync(monitorOwner(invocation.monitorOwner), params),
    "git.workspace.watch.clear": (state, params, invocation) =>
      state.workspaceSync.clear(
        monitorOwner(invocation.monitorOwner),
        params.projectId,
      ),
    "git.workspace.snapshot.get": (state, params) =>
      state.workspaceSync.snapshot(params.projectId),
    "git.repo.detail.get": (state, params) =>
      state.workspaceSync.detail(params.projectId, repo(params)),
    "git.workspace.refresh": (state, params) =>
      state.workspaceSync.refresh(
        params.projectId,
        params.repo,
        params.force ?? true,
      ),
    "git.project.files.status.get": (state, params) =>
      state.git.projectFileStatus(params.projectId, params.refresh),
    "git.branches.list": (state, params) =>
      state.git.listBranches(params.projectId, repo(params)),
    "git.branch.create": (state, params) =>
      withRevision(state, params, () =>
        state.git.createBranch(params.projectId, repo(params), params.name),
      ),
    "git.branch.switch": (state, params) =>
      withRevision(state, params, () =>
        state.git.switchBranch(params.projectId, repo(params), params.name),
      ),
    "git.branch.delete": (state, params) =>
      withRevision(state, params, () =>
        state.git.deleteBranch(params.projectId, repo(params), params.name),
      ),
    "git.file.diff.get": (state, params) =>
      state.git.fileDiff(
        params.projectId,
        repo(params),
        params.path,
        params.area,
      ),
    "git.file.stage": (state, params) =>
      withRevision(state, params, () =>
        state.git.stageFile(params.projectId, repo(params), params.path),
      ),
    "git.file.unstage": (state, params) =>
      withRevision(state, params, () =>
        state.git.unstageFile(params.projectId, repo(params), params.path),
      ),
    "git.file.discard": (state, params) =>
      withRevision(state, params, () =>
        state.git.discardFile(params.projectId, repo(params), params.path),
      ),
    "git.stash.create": (state, params) =>
      withRevision(state, params, () =>
        state.git.createStash(
          params.projectId,
          repo(params),
          params.area,
          params.paths,
        ),
      ),
    "git.stash.apply": (state, params) =>
      withRevision(state, params, () =>
        state.git.applyStash(
          params.projectId,
          repo(params),
          params.index,
          params.expectedHash,
        ),
      ),
    "git.stash.drop": (state, params) =>
      withRevision(state, params, () =>
        state.git.dropStash(
          params.projectId,
          repo(params),
          params.index,
          params.expectedHash,
        ),
      ),
    "github.status.get": (state, params) =>
      state.git.githubStatus(params.projectId, repo(params)),
    "github.pr.snapshot.get": (state, params) =>
      state.prSync.snapshot(params.projectId, params.repo),
    "github.pr.watch.sync": (state, params, invocation) =>
      state.prSync.sync(monitorOwner(invocation.monitorOwner), {
        ...params,
        list: params.list ?? false,
        prs: params.prs ?? [],
      }),
    "github.pr.watch.clear": (state, params, invocation) =>
      state.prSync.clear(
        monitorOwner(invocation.monitorOwner),
        params.projectId,
        params.repo,
      ),
    "github.pr.refresh": (state, params) =>
      state.prSync.refresh(params.projectId, params.repo, params.number),
    "github.pr.expect": (state, params) =>
      state.prSync.expect(params.projectId, params.repo, params.branch),
    "github.pr.list": (state, params) =>
      state.git.listOpenPrs(
        params.projectId,
        repo(params),
        params.filters as GithubPrListFilters,
      ),
    "github.pr.initial.get": (state, params) =>
      state.git.prInitial(params.projectId, repo(params), params.number),
    "github.pr.core.get": (state, params) =>
      state.git.prCore(params.projectId, repo(params), params.number),
    "github.pr.conversation.get": (state, params) =>
      state.git.prConversation(params.projectId, repo(params), params.number),
    "github.pr.overview.get": (state, params) =>
      state.git.prOverview(params.projectId, repo(params), params.number),
    "github.pr.commits.get": (state, params) =>
      state.git.prCommits(params.projectId, repo(params), params.number),
    "github.pr.checks.get": (state, params) =>
      state.git.prChecks(params.projectId, repo(params), params.number),
    "github.pr.files.get": (state, params) =>
      state.git.prFiles(params.projectId, repo(params), params.number),
    "github.pr.file.diff.get": (state, params) =>
      state.git.prFileDiff(params.projectId, repo(params), params.number, {
        path: params.path,
        previousPath: params.previousPath,
        status: params.status,
        expectedBaseRefOid: params.expectedBaseRefOid,
        expectedHeadRefOid: params.expectedHeadRefOid,
        ...(params.expectedHeadRepository
          ? { expectedHeadRepository: params.expectedHeadRepository }
          : {}),
      }),
    "github.pr.merge": (state, params) =>
      state.git.mergePr(
        params.projectId,
        repo(params),
        params.number,
        params.method,
        params.expectedHeadOid,
      ),
  });

function monitorOwner(owner: string | undefined): string {
  if (!owner)
    throw new Error("Git monitoring requires a live protocol session");
  return owner;
}

function repo(params: { repo?: string }): string {
  return params.repo || ".";
}

/** Awaits the workspace read that includes the mutation's effect (bounded). */
async function withRevision(
  state: GitMethodContext,
  params: { projectId: string; repo?: string },
  run: () => Promise<GitMutationResponse>,
): Promise<GitMutationResponse & { workspaceRevision: number }> {
  const result = await run();
  return {
    ...result,
    workspaceRevision: await state.workspaceSync.mutated(
      params.projectId,
      repo(params),
    ),
  };
}
