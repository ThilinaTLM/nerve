import type { GithubPrListFilters } from "@nervekit/contracts/git";
import {
  defineWorkbenchMethodHandlersFor,
  type WorkbenchMethodHandlerMapFor,
} from "../method-handler-registry.js";
import type { ServerAdapterContexts } from "../../../app/bootstrap/create-server-adapter-contexts.js";

type GitMethodContext = ServerAdapterContexts["protocol"]["git"];
const defineGitMethodHandlers =
  defineWorkbenchMethodHandlersFor<GitMethodContext>();

export const gitMethodHandlers: WorkbenchMethodHandlerMapFor<GitMethodContext> =
  defineGitMethodHandlers({
    "git.repos.discover": (state, params) =>
      state.git.discoverRepos(params.projectId),
    "git.overview.get": (state, params) =>
      state.git.overview(params.projectId, repo(params)),
    "git.project.files.status.get": (state, params) =>
      state.git.projectFileStatus(params.projectId),
    "git.branches.list": (state, params) =>
      state.git.listBranches(params.projectId, repo(params)),
    "git.branch.create": (state, params) =>
      state.git.createBranch(params.projectId, repo(params), params.name),
    "git.branch.switch": (state, params) =>
      state.git.switchBranch(params.projectId, repo(params), params.name),
    "git.file.diff.get": (state, params) =>
      state.git.fileDiff(
        params.projectId,
        repo(params),
        params.path,
        params.area,
      ),
    "git.file.stage": (state, params) =>
      state.git.stageFile(params.projectId, repo(params), params.path),
    "git.file.unstage": (state, params) =>
      state.git.unstageFile(params.projectId, repo(params), params.path),
    "git.file.discard": (state, params) =>
      state.git.discardFile(params.projectId, repo(params), params.path),
    "git.sync": (state, params) =>
      state.git.syncBranch(params.projectId, repo(params)),
    "git.push": (state, params) =>
      state.git.push(params.projectId, repo(params)),
    "git.pull": (state, params) =>
      state.git.pull(params.projectId, repo(params)),
    "git.fetch": (state, params) =>
      state.git.fetch(params.projectId, repo(params)),
    "git.switchBaseAndPull": (state, params) =>
      state.git.switchBaseAndPull(params.projectId, repo(params)),
    "git.stash.create": (state, params) =>
      state.git.createStash(
        params.projectId,
        repo(params),
        params.area,
        params.paths,
      ),
    "git.stash.apply": (state, params) =>
      state.git.applyStash(
        params.projectId,
        repo(params),
        params.index,
        params.expectedHash,
      ),
    "git.stash.drop": (state, params) =>
      state.git.dropStash(
        params.projectId,
        repo(params),
        params.index,
        params.expectedHash,
      ),
    "github.status.get": (state, params) =>
      state.git.githubStatus(params.projectId, repo(params)),
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
    "github.pr.checkout": (state, params) =>
      state.git.checkoutPr(params.projectId, repo(params), params.number),
    "github.pr.merge": (state, params) =>
      state.git.mergePr(
        params.projectId,
        repo(params),
        params.number,
        params.method,
        params.expectedHeadOid,
      ),
  });

function repo(params: { repo?: string }): string {
  return params.repo || ".";
}
