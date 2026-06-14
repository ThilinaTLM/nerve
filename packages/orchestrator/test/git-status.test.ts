import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseGithubChecks,
  summarizeChecks,
} from "../src/domains/git/git-service.js";
import {
  parsePorcelainV2,
  parseShortstat,
} from "../src/domains/git/git-status.js";

describe("parsePorcelainV2", () => {
  it("parses branch headers with upstream and ahead/behind", () => {
    const out = [
      "# branch.oid abc123",
      "# branch.head feature/login",
      "# branch.upstream origin/feature/login",
      "# branch.ab +2 -1",
      "",
    ].join("\n");
    const { branch, files } = parsePorcelainV2(out);
    assert.equal(branch.head, "feature/login");
    assert.equal(branch.detached, false);
    assert.equal(branch.upstream, "origin/feature/login");
    assert.equal(branch.ahead, 2);
    assert.equal(branch.behind, 1);
    assert.equal(files.length, 0);
  });

  it("marks detached HEAD", () => {
    const { branch } = parsePorcelainV2("# branch.head (detached)\n");
    assert.equal(branch.detached, true);
    assert.equal(branch.head, null);
  });

  it("parses staged, unstaged, and untracked entries", () => {
    const out = [
      "# branch.head main",
      "1 M. N... 100644 100644 100644 aaa bbb src/staged.ts",
      "1 .M N... 100644 100644 100644 ccc ddd src/worktree.ts",
      "? untracked.txt",
    ].join("\n");
    const { files } = parsePorcelainV2(out);
    assert.equal(files.length, 3);

    const staged = files.find((f) => f.path === "src/staged.ts");
    assert.ok(staged);
    assert.equal(staged?.staged, true);
    assert.equal(staged?.index, "M");

    const worktree = files.find((f) => f.path === "src/worktree.ts");
    assert.ok(worktree);
    assert.equal(worktree?.staged, false);
    assert.equal(worktree?.worktree, "M");

    const untracked = files.find((f) => f.path === "untracked.txt");
    assert.ok(untracked);
    assert.equal(untracked?.untracked, true);
  });

  it("parses renamed entries with original path", () => {
    const out = [
      "# branch.head main",
      "2 R. N... 100644 100644 100644 aaa bbb R100 new/path.ts\told/path.ts",
    ].join("\n");
    const { files } = parsePorcelainV2(out);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, "new/path.ts");
    assert.equal(files[0].renamedFrom, "old/path.ts");
    assert.equal(files[0].index, "R");
    assert.equal(files[0].staged, true);
  });

  it("handles paths with spaces", () => {
    const out =
      "# branch.head main\n1 .M N... 100644 100644 100644 a b src/my file.ts";
    const { files } = parsePorcelainV2(out);
    assert.equal(files[0].path, "src/my file.ts");
  });
});

describe("parseShortstat", () => {
  it("extracts insertions and deletions", () => {
    const result = parseShortstat(
      " 3 files changed, 12 insertions(+), 4 deletions(-)",
    );
    assert.equal(result.insertions, 12);
    assert.equal(result.deletions, 4);
  });

  it("defaults to zero when absent", () => {
    const result = parseShortstat("");
    assert.equal(result.insertions, 0);
    assert.equal(result.deletions, 0);
  });
});

describe("summarizeChecks", () => {
  it("reports passing when all succeed", () => {
    const summary = summarizeChecks([
      { name: "build", state: "SUCCESS" },
      { name: "lint", state: "SKIPPED" },
    ]);
    assert.equal(summary.status, "passing");
    assert.equal(summary.passed, 2);
    assert.equal(summary.failed, 0);
  });

  it("reports failing when any fails", () => {
    const summary = summarizeChecks([
      { name: "build", state: "SUCCESS" },
      { name: "test", state: "FAILURE" },
    ]);
    assert.equal(summary.status, "failing");
    assert.equal(summary.failed, 1);
  });

  it("reports pending when checks are in progress", () => {
    const summary = summarizeChecks([{ name: "deploy", state: "PENDING" }]);
    assert.equal(summary.status, "pending");
    assert.equal(summary.pending, 1);
  });

  it("reports none for empty input", () => {
    const summary = summarizeChecks([]);
    assert.equal(summary.status, "none");
    assert.equal(summary.total, 0);
  });

  it("parses pending check JSON captured from gh stdout", () => {
    const summary = parseGithubChecks(
      JSON.stringify([
        { name: "build", state: "PENDING", link: "https://example.test" },
      ]),
    );
    assert.equal(summary.status, "pending");
    assert.equal(summary.pending, 1);
    assert.equal(summary.runs[0].url, "https://example.test");
  });

  it("parses failing check JSON captured from gh stdout", () => {
    const summary = parseGithubChecks(
      JSON.stringify([{ name: "test", state: "FAILURE" }]),
    );
    assert.equal(summary.status, "failing");
    assert.equal(summary.failed, 1);
  });
});
