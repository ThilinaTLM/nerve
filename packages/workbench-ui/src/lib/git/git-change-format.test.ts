import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitRepoSummary } from "@nervekit/contracts";
import { repoButtonLabel, shortenMiddle } from "./git-change-format.js";

function repo(overrides: Partial<GitRepoSummary> = {}): GitRepoSummary {
  return {
    relativePath: ".",
    absDir: "/repo",
    name: "repo",
    isRepo: true,
    currentBranch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    hasRemote: true,
    hasGithubRemote: true,
    baseBranch: "main",
    onBaseBranch: true,
    mergedToBase: false,
    dirty: false,
    changeCount: 0,
    ...overrides,
  };
}

describe("repoButtonLabel", () => {
  it("uses names when unique and paths when duplicated", () => {
    assert.equal(
      repoButtonLabel(repo({ name: "web" }), [repo({ name: "web" })]),
      "web",
    );
    const repos = [
      repo({ relativePath: "apps/admin/web", name: "web" }),
      repo({ relativePath: "apps/customer/web", name: "web" }),
    ];
    assert.equal(repoButtonLabel(repos[0], repos), "apps/admin/web");
    assert.equal(repoButtonLabel(repos[1], repos), "apps/customer/web");
  });

  it("shortens labels while retaining both ends", () => {
    assert.equal(
      shortenMiddle("packages/super-long-web-client", 12),
      "packag…lient",
    );
  });
});
