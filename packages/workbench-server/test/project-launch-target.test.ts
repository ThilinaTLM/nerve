import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ProjectRecord } from "@nervekit/contracts";
import { resolveProjectLaunchTarget } from "../src/domains/projects/project-launch-target.js";

function projectAt(dir: string): ProjectRecord {
  return {
    id: "proj_target",
    name: "Target project",
    dir,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveProjectLaunchTarget", () => {
  it("resolves root, files, and directories and enforces directory targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-launch-target-"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "");
    const project = projectAt(root);
    try {
      assert.equal(await resolveProjectLaunchTarget(project), root);
      assert.equal(
        await resolveProjectLaunchTarget(project, "src/main.ts"),
        join(root, "src", "main.ts"),
      );
      assert.equal(
        await resolveProjectLaunchTarget(project, "src", { directory: true }),
        join(root, "src"),
      );
      await assert.rejects(
        resolveProjectLaunchTarget(project, "src/main.ts", {
          directory: true,
        }),
        /must be a directory/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal, missing targets, and escaping symlinks", async () => {
    const parent = await mkdtemp(join(tmpdir(), "nerve-launch-escape-"));
    const root = join(parent, "project");
    const outside = join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(root, "escape"));
    const project = projectAt(root);
    try {
      for (const path of ["../outside", "/tmp/file", "src//file", "missing"]) {
        await assert.rejects(resolveProjectLaunchTarget(project, path));
      }
      await assert.rejects(
        resolveProjectLaunchTarget(project, "escape"),
        /escapes the project root/,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
