import type { GithubPrListFilters } from "@nervekit/contracts";
import { defineWorkbenchMethodHandlers } from "../method-handler-registry.js";

export const gitMethodHandlers = defineWorkbenchMethodHandlers({
  "git.repos.discover": (state, params) =>
    state.services.git.discoverRepos(params.projectId),
  "git.overview.get": (state, params) =>
    state.services.git.overview(params.projectId, repo(params)),
  "git.project.files.status.get": (state, params) =>
    state.services.git.projectFileStatus(params.projectId),
  "git.branches.list": (state, params) =>
    state.services.git.listBranches(params.projectId, repo(params)),
  "git.branch.create": (state, params) =>
    state.services.git.createBranch(
      params.projectId,
      repo(params),
      params.name,
    ),
  "git.branch.switch": (state, params) =>
    state.services.git.switchBranch(
      params.projectId,
      repo(params),
      params.name,
    ),
  "git.file.diff.get": (state, params) =>
    state.services.git.fileDiff(
      params.projectId,
      repo(params),
      params.path,
      params.area,
    ),
  "git.file.stage": (state, params) =>
    state.services.git.stageFile(params.projectId, repo(params), params.path),
  "git.file.unstage": (state, params) =>
    state.services.git.unstageFile(params.projectId, repo(params), params.path),
  "git.file.discard": (state, params) =>
    state.services.git.discardFile(params.projectId, repo(params), params.path),
  "git.sync": (state, params) =>
    state.services.git.syncBranch(params.projectId, repo(params)),
  "git.push": (state, params) =>
    state.services.git.push(params.projectId, repo(params)),
  "git.pull": (state, params) =>
    state.services.git.pull(params.projectId, repo(params)),
  "git.fetch": (state, params) =>
    state.services.git.fetch(params.projectId, repo(params)),
  "git.switchBaseAndPull": (state, params) =>
    state.services.git.switchBaseAndPull(params.projectId, repo(params)),
  "git.stash.create": (state, params) =>
    state.services.git.createStash(
      params.projectId,
      repo(params),
      params.area,
      params.paths,
    ),
  "git.stash.apply": (state, params) =>
    state.services.git.applyStash(
      params.projectId,
      repo(params),
      params.index,
      params.expectedHash,
    ),
  "git.stash.drop": (state, params) =>
    state.services.git.dropStash(
      params.projectId,
      repo(params),
      params.index,
      params.expectedHash,
    ),
  "github.status.get": (state, params) =>
    state.services.git.githubStatus(params.projectId, repo(params)),
  "github.pr.list": (state, params) =>
    state.services.git.listOpenPrs(
      params.projectId,
      repo(params),
      params.filters as GithubPrListFilters,
    ),
  "github.pr.initial.get": (state, params) =>
    state.services.git.prInitial(params.projectId, repo(params), params.number),
  "github.pr.core.get": (state, params) =>
    state.services.git.prCore(params.projectId, repo(params), params.number),
  "github.pr.conversation.get": (state, params) =>
    state.services.git.prConversation(
      params.projectId,
      repo(params),
      params.number,
    ),
  "github.pr.overview.get": (state, params) =>
    state.services.git.prOverview(
      params.projectId,
      repo(params),
      params.number,
    ),
  "github.pr.commits.get": (state, params) =>
    state.services.git.prCommits(params.projectId, repo(params), params.number),
  "github.pr.checks.get": (state, params) =>
    state.services.git.prChecks(params.projectId, repo(params), params.number),
  "github.pr.files.get": (state, params) =>
    state.services.git.prFiles(params.projectId, repo(params), params.number),
  "github.pr.file.diff.get": (state, params) =>
    state.services.git.prFileDiff(
      params.projectId,
      repo(params),
      params.number,
      {
        path: params.path,
        previousPath: params.previousPath,
        status: params.status,
        expectedBaseRefOid: params.expectedBaseRefOid,
        expectedHeadRefOid: params.expectedHeadRefOid,
        ...(params.expectedHeadRepository
          ? { expectedHeadRepository: params.expectedHeadRepository }
          : {}),
      },
    ),
  "github.pr.checkout": (state, params) =>
    state.services.git.checkoutPr(
      params.projectId,
      repo(params),
      params.number,
    ),
  "github.pr.merge": (state, params) =>
    state.services.git.mergePr(
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
