import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseProjectEntryTarget,
  resolveProjectEntryPath,
} from "../src/ipc/project-entry-path.js";

const segmentsOf = (relativePath: string) =>
  parseProjectEntryTarget({ projectId: "proj_1", relativePath }).segments;

describe("desktop project entry targets", () => {
  it("requires a project id and string path, and never accepts a root", () => {
    assert.throws(() => parseProjectEntryTarget(undefined));
    assert.throws(() => parseProjectEntryTarget({ relativePath: "a" }));
    assert.throws(() =>
      parseProjectEntryTarget({ projectId: " ", relativePath: "a" }),
    );
    assert.deepEqual(
      parseProjectEntryTarget({
        projectId: "proj_1",
        root: "/",
        relativePath: "a/b",
      }),
      { projectId: "proj_1", segments: ["a", "b"] },
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
      assert.throws(() => segmentsOf(relativePath), relativePath);
    }
  });
});

describe("desktop project entry paths", () => {
  it("resolves nested POSIX and Windows project-relative paths", () => {
    assert.equal(
      resolveProjectEntryPath(
        "/workspace/project",
        segmentsOf("src/main.ts"),
        "linux",
      ),
      "/workspace/project/src/main.ts",
    );
    assert.equal(
      resolveProjectEntryPath(
        "C:\\workspace\\project",
        segmentsOf("src/main.ts"),
        "win32",
      ),
      "C:\\workspace\\project\\src\\main.ts",
    );
  });

  it("resolves an empty path to the project root and rejects relative roots", () => {
    assert.equal(
      resolveProjectEntryPath("/workspace/project", segmentsOf(""), "linux"),
      "/workspace/project",
    );
    assert.throws(() =>
      resolveProjectEntryPath("workspace/project", segmentsOf("a"), "linux"),
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

      await resolveContainedProjectEntryPath(root, segmentsOf("ok.txt"), {
        followLeaf: true,
      });
      await assert.rejects(
        resolveContainedProjectEntryPath(root, segmentsOf("dir/f.txt"), {
          followLeaf: false,
        }),
        /escapes/,
      );
      await assert.rejects(
        resolveContainedProjectEntryPath(root, segmentsOf("file-link"), {
          followLeaf: true,
        }),
        /escapes/,
      );
      // The link itself may be revealed/trashed.
      await resolveContainedProjectEntryPath(root, segmentsOf("file-link"), {
        followLeaf: false,
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
