import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GitService } from "../../src/git/git-service.js";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" });

test("repoSummary matches the overview's summary without reading files or stashes", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-summary-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  writeFileSync(join(root, "a.txt"), "changed");
  writeFileSync(join(root, "b.txt"), "new");
  const service = GitService.forWorkspace(root, "summary");
  try {
    const summary = await service.repoSummary("proj_summary", ".");
    const overview = await service.overview("proj_summary", ".");
    assert.deepEqual(summary, overview.repo);
    assert.equal(summary.changeCount, 2);
    assert.equal(summary.currentBranch, "main");
    assert.equal("files" in summary, false);
  } finally {
    await service.closeRemoteCaches();
  }
});

test("a branch still at the base tip is not merged; a merged branch with its own commits is", async () => {
  const root = mkdtempSync(join(tmpdir(), "git-merged-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "t@example.com");
  git(root, "config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  git(root, "switch", "-q", "-c", "feature");
  const service = GitService.forWorkspace(root, "merged");
  try {
    assert.equal(
      (await service.repoSummary("proj_merged", ".")).mergedToBase,
      false,
    );
    writeFileSync(join(root, "b.txt"), "b");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "work");
    git(root, "switch", "-q", "main");
    git(root, "merge", "-q", "--no-ff", "-m", "merge", "feature");
    git(root, "switch", "-q", "feature");
    service.invalidateRepoReads("proj_merged", ".");
    assert.equal(
      (await service.repoSummary("proj_merged", ".")).mergedToBase,
      true,
    );
  } finally {
    await service.closeRemoteCaches();
  }
});
