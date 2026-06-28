import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitRepoSummary } from "$lib/api";
import { repoButtonLabel, shortenMiddle } from "./git-change-format";

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
  it("uses the repo basename for unique repo names", () => {
    const repos = [repo({ relativePath: "packages/web", name: "web" })];

    assert.equal(repoButtonLabel(repos[0], repos), "web");
  });

  it("uses relative paths when repo basenames are duplicated", () => {
    const repos = [
      repo({ relativePath: "apps/admin/web", name: "web" }),
      repo({ relativePath: "apps/customer/web", name: "web" }),
    ];

    assert.equal(repoButtonLabel(repos[0], repos), "apps/admin/web");
    assert.equal(repoButtonLabel(repos[1], repos), "apps/customer/web");
  });

  it("shortens labels in large repo lists", () => {
    const repos = Array.from({ length: 9 }, (_, index) =>
      repo({
        relativePath: `packages/very-long-repository-${index}`,
        name: `very-long-repository-${index}`,
      }),
    );

    const label = repoButtonLabel(repos[0], repos);

    assert.ok(label.includes("…"));
    assert.ok(label.length <= 12);
  });
});

describe("shortenMiddle", () => {
  it("preserves short values", () => {
    assert.equal(shortenMiddle("packages/web", 20), "packages/web");
  });

  it("keeps both ends of long values", () => {
    assert.equal(
      shortenMiddle("packages/super-long-web-client", 12),
      "packag…lient",
    );
  });
});
