import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { GitOverviewResponse } from "@nervekit/contracts/git";
import { GitOverviewCoalescer } from "../../src/git/git-overview-coalescer.js";

const root = mkdtempSync(join(tmpdir(), "git-overview-"));
for (const name of ["a", "b"])
  mkdirSync(join(root, name, ".git"), { recursive: true });
const response = { files: [] } as unknown as GitOverviewResponse;

function setup() {
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const coalescer = new GitOverviewCoalescer({
    resolveRepoDir: (_project, path) => join(root, path),
    readOverview: async () => {
      reads++;
      await gate;
      return response;
    },
  });
  return { coalescer, release, reads: () => reads };
}

test("coalesces concurrent overview reads per repository", async () => {
  const { coalescer, release, reads } = setup();
  const a = coalescer.overview("p", "a");
  const b = coalescer.overview("p", "a");
  const c = coalescer.overview("p", "b");
  release();
  await Promise.all([a, b, c]);
  assert.equal(reads(), 2);
});

test("uncertain invalidation marks in-flight overviews stale", async () => {
  const { coalescer, release } = setup();
  const pending = coalescer.overview("p", "a");
  coalescer.invalidate("p", { uncertain: true });
  release();
  assert.equal((await pending).stale, true);
});

test("close rejects new reads", async () => {
  const { coalescer, release } = setup();
  release();
  await coalescer.close();
  await assert.rejects(coalescer.overview("p", "a"), /closed/);
});
