import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { pruneCrashReports } from "../src/infrastructure/diagnostics/index.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-crash-retention-"));
  roots.push(root);
  return root;
}

describe("crash report retention", () => {
  it("removes old regular reports and preserves recent or non-file entries", async () => {
    const root = await home();
    const crashes = join(root, "crashes");
    await mkdir(join(crashes, "nested"), { recursive: true });
    const oldNerve = join(crashes, "2026-01-01T00-00-00-000Z-crash_old.json");
    const oldNode = join(crashes, "report.20260101.000000.1.0.001.json");
    const recent = join(crashes, "recent.json");
    const outside = join(root, "outside.json");
    await Promise.all([
      writeFile(oldNerve, "nerve"),
      writeFile(oldNode, "node"),
      writeFile(recent, "recent"),
      writeFile(outside, "outside"),
    ]);
    const old = new Date("2026-01-01T00:00:00.000Z");
    await Promise.all([utimes(oldNerve, old, old), utimes(oldNode, old, old)]);
    await symlink(outside, join(crashes, "linked.json"));

    const result = await pruneCrashReports(
      root,
      14,
      Date.parse("2026-02-01T00:00:00.000Z"),
    );

    assert.equal(result.removedItems, 2);
    assert.equal(result.freedBytes, 9);
    await assert.rejects(lstat(oldNerve), /ENOENT/);
    await assert.rejects(lstat(oldNode), /ENOENT/);
    assert.equal(await readFile(recent, "utf8"), "recent");
    assert.equal(await readFile(outside, "utf8"), "outside");
    assert.equal(
      (await lstat(join(crashes, "linked.json"))).isSymbolicLink(),
      true,
    );
    assert.ok(result.skipped >= 2);
  });

  it("tolerates a missing crash directory", async () => {
    const root = await home();
    assert.deepEqual(await pruneCrashReports(root, 14), {
      freedBytes: 0,
      removedItems: 0,
      skipped: 0,
    });
  });
});
