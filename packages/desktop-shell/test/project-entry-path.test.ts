import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveProjectEntryPath } from "../src/ipc/project-entry-path.js";

describe("desktop project entry paths", () => {
  it("resolves nested POSIX and Windows project-relative paths", () => {
    assert.equal(
      resolveProjectEntryPath(
        { root: "/workspace/project", relativePath: "src/main.ts" },
        "linux",
      ),
      "/workspace/project/src/main.ts",
    );
    assert.equal(
      resolveProjectEntryPath(
        { root: "C:\\workspace\\project", relativePath: "src/main.ts" },
        "win32",
      ),
      "C:\\workspace\\project\\src\\main.ts",
    );
  });

  it("resolves an empty path to the project root", () => {
    assert.equal(
      resolveProjectEntryPath(
        { root: "/workspace/project", relativePath: "" },
        "linux",
      ),
      "/workspace/project",
    );
  });

  it("rejects absolute and traversing paths", () => {
    for (const relativePath of [
      "/tmp/file",
      "C:/tmp/file",
      "../file",
      "src/../../file",
      "src//file",
    ]) {
      assert.throws(() =>
        resolveProjectEntryPath(
          { root: "/workspace/project", relativePath },
          "linux",
        ),
      );
    }
    assert.throws(() =>
      resolveProjectEntryPath(
        { root: "workspace/project", relativePath: "src/main.ts" },
        "linux",
      ),
    );
  });
});

describe("contained project entry paths", () => {
  it("rejects symlinked entries and parents that escape the root", async () => {
    const { mkdtemp, mkdir, rm, symlink, writeFile } =
      await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { resolveContainedProjectEntryPath } =
      await import("../src/ipc/project-entry-path.js");
    const base = await mkdtemp(join(tmpdir(), "nerve-entry-"));
    try {
      const root = join(base, "project");
      const outside = join(base, "outside");
      await mkdir(root);
      await mkdir(outside);
      await writeFile(join(outside, "f.txt"), "x");
      await writeFile(join(root, "ok.txt"), "x");
      await symlink(outside, join(root, "dir"));
      await symlink(join(outside, "f.txt"), join(root, "file-link"));

      await resolveContainedProjectEntryPath(
        { root, relativePath: "ok.txt" },
        { followLeaf: true },
      );
      await assert.rejects(
        resolveContainedProjectEntryPath(
          { root, relativePath: "dir/f.txt" },
          { followLeaf: false },
        ),
        /escapes/,
      );
      await assert.rejects(
        resolveContainedProjectEntryPath(
          { root, relativePath: "file-link" },
          { followLeaf: true },
        ),
        /escapes/,
      );
      // The link itself may be revealed/trashed.
      await resolveContainedProjectEntryPath(
        { root, relativePath: "file-link" },
        { followLeaf: false },
      );
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
