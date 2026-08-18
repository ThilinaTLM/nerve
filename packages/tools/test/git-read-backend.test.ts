import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { NativeGitReadError } from "@nervekit/native";
import type { GitReadBackend } from "../src/git/git-read-backend.js";
import { GitReadBackendRouter } from "../src/git/git-read-backend.js";

const emptySnapshot = {
  headOid: null,
  branch: {
    head: null,
    detached: false,
    upstream: null,
    ahead: null,
    behind: null,
  },
  refs: [],
  remotes: [],
  files: [],
  recentCommits: [],
  stashes: [],
};

function backend(snapshot: GitReadBackend["snapshot"]): GitReadBackend {
  return {
    isRepository: async () => true,
    snapshot,
    isAncestor: async () => false,
    resolveRevision: async (_repoDir, revision) => revision,
    validateBranchName: async () => true,
    fileDiff: async () => ({
      original: { content: "", binary: false, size: 0 },
      modified: { content: "", binary: false, size: 0 },
    }),
  };
}

describe("Git read backend routing", () => {
  it("falls back only for typed unsupported results", async () => {
    let compatibilityCalls = 0;
    const observations: unknown[] = [];
    const router = new GitReadBackendRouter(
      backend(async () => {
        throw new NativeGitReadError("unsupported", "unsupported fixture");
      }),
      backend(async () => {
        compatibilityCalls += 1;
        return emptySnapshot;
      }),
      (observation) => observations.push(observation),
    );

    assert.equal((await router.snapshot("/repo")).files.length, 0);
    assert.equal(compatibilityCalls, 1);
    assert.deepEqual(
      observations.map((value) => ({
        backend: (value as { backend: string }).backend,
        fallbackCategory: (value as { fallbackCategory?: string })
          .fallbackCategory,
      })),
      [
        { backend: "native", fallbackCategory: "unsupported" },
        {
          backend: "cli-compatibility",
          fallbackCategory: "unsupported",
        },
      ],
    );
  });

  it("does not mask corruption with the compatibility backend", async () => {
    let compatibilityCalls = 0;
    const router = new GitReadBackendRouter(
      backend(async () => {
        throw new NativeGitReadError("corrupt", "broken object database");
      }),
      backend(async () => {
        compatibilityCalls += 1;
        return emptySnapshot;
      }),
    );

    await assert.rejects(router.snapshot("/repo"), /broken object database/);
    assert.equal(compatibilityCalls, 0);
  });

  it("keeps gh restricted to token acquisition", async () => {
    const service = await readFile(
      new URL("../src/git/git-service.ts", import.meta.url),
      "utf8",
    );
    const githubService = await readFile(
      new URL("../src/git/git-github-service.ts", import.meta.url),
      "utf8",
    );
    assert.match(service, /"auth",\s*"token",\s*"--hostname"/);
    assert.doesNotMatch(githubService, /runGh|\bgh\s+pr\b/);
  });
});
