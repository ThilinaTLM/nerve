import type { GithubPrListFilters } from "@nervekit/contracts";
import { defineWorkbenchMethodHandlers } from "../method-handler-registry.js";

export const gitMethodHandlers = defineWorkbenchMethodHandlers({
  "git.repos.discover": (state, params) =>
    state.registry.git.discoverRepos(params.projectId),
  "git.overview.get": (state, params) =>
    state.registry.git.overview(params.projectId, repo(params)),
  "git.branches.list": (state, params) =>
    state.registry.git.listBranches(params.projectId, repo(params)),
  "git.branch.create": (state, params) =>
    state.registry.git.createBranch(
      params.projectId,
      repo(params),
      params.name,
    ),
  "git.branch.switch": (state, params) =>
    state.registry.git.switchBranch(
      params.projectId,
      repo(params),
      params.name,
    ),
  "git.file.stage": (state, params) =>
    state.registry.git.stageFile(params.projectId, repo(params), params.path),
  "git.file.unstage": (state, params) =>
    state.registry.git.unstageFile(params.projectId, repo(params), params.path),
  "git.file.discard": (state, params) =>
    state.registry.git.discardFile(params.projectId, repo(params), params.path),
  "git.sync": (state, params) =>
    state.registry.git.syncBranch(params.projectId, repo(params)),
  "git.push": (state, params) =>
    state.registry.git.push(params.projectId, repo(params)),
  "git.pull": (state, params) =>
    state.registry.git.pull(params.projectId, repo(params)),
  "git.fetch": (state, params) =>
    state.registry.git.fetch(params.projectId, repo(params)),
  "git.switchBaseAndPull": (state, params) =>
    state.registry.git.switchBaseAndPull(params.projectId, repo(params)),
  "github.status.get": (state, params) =>
    state.registry.git.githubStatus(params.projectId, repo(params)),
  "github.pr.list": (state, params) =>
    state.registry.git.listOpenPrs(
      params.projectId,
      repo(params),
      params.filters as GithubPrListFilters,
    ),
  "github.pr.get": (state, params) =>
    state.registry.git.prDetail(params.projectId, repo(params), params.number),
  "github.pr.checkout": (state, params) =>
    state.registry.git.checkoutPr(
      params.projectId,
      repo(params),
      params.number,
    ),
});

function repo(params: { repo?: string }): string {
  return params.repo || ".";
}
