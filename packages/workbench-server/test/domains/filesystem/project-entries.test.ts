import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  clearProjectListingCache,
  projectDirectoryEntries,
} from "../../../src/domains/filesystem/project-listing.js";
import { setNativeFilesForTesting } from "../../../src/domains/filesystem/native-files.js";
import {
  copyProjectEntry,
  deleteProjectEntries,
  moveProjectEntry,
  uploadProjectFiles,
} from "../../../src/domains/filesystem/project-entry-mutations.js";

let root: string;
let outside: string;
const dir = () => root;

const file = (name: string, text: string) => ({
  name,
  size: text.length,
  bytes: async () => new TextEncoder().encode(text),
});

async function rejects(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: { code?: string }) => {
    assert.equal(error.code, code);
    return true;
  });
}

beforeEach(async () => {
  setNativeFilesForTesting(undefined);
  clearProjectListingCache();
  const base = await mkdtemp(join(tmpdir(), "nerve-entries-"));
  root = join(base, "project");
  outside = join(base, "outside");
  await mkdir(join(root, "src", "nested"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(root, "src", "a.txt"), "a");
  await writeFile(join(root, "src", "nested", "b.txt"), "b");
  await writeFile(join(outside, "secret.txt"), "s");
  await symlink(outside, join(root, "link"));
  await symlink("a.txt", join(root, "src", "rel-link"));
});

afterEach(async () => {
  setNativeFilesForTesting(null);
  await rm(join(root, ".."), { recursive: true, force: true });
});

describe("move", () => {
  it("renames and moves entries", async () => {
    const { entry } = await moveProjectEntry(
      { projectId: "p", from: "src/a.txt", to: "src/nested/c.txt" },
      dir,
    );
    assert.equal(entry.path, "src/nested/c.txt");
    assert.equal(await readFile(join(root, "src/nested/c.txt"), "utf8"), "a");
  });

  it("rejects existing targets, self moves, root and escapes", async () => {
    await rejects(
      moveProjectEntry(
        { projectId: "p", from: "src/a.txt", to: "src/nested" },
        dir,
      ),
      "PROJECT_ENTRY_EXISTS",
    );
    await rejects(
      moveProjectEntry(
        { projectId: "p", from: "src", to: "src/nested/src" },
        dir,
      ),
      "PROJECT_ENTRY_INTO_SELF",
    );
    await rejects(
      moveProjectEntry(
        { projectId: "p", from: "src/a.txt", to: "link/a.txt" },
        dir,
      ),
      "FILE_PATH_OUTSIDE_PROJECT",
    );
    await rejects(
      moveProjectEntry(
        { projectId: "p", from: "link/secret.txt", to: "s.txt" },
        dir,
      ),
      "FILE_PATH_OUTSIDE_PROJECT",
    );
    await rejects(
      moveProjectEntry({ projectId: "p", from: "src/a.txt", to: "../x" }, dir),
      "INVALID_PROJECT_PATH",
    );
  });
});

describe("copy", () => {
  it("copies directories recursively and keeps symlinks as links", async () => {
    await copyProjectEntry({ projectId: "p", from: "src", to: "copy" }, dir);
    assert.equal(await readFile(join(root, "copy/nested/b.txt"), "utf8"), "b");
    assert.equal(await readlink(join(root, "copy/rel-link")), "a.txt");
    await stat(join(root, "src/a.txt"));
    await rejects(
      copyProjectEntry({ projectId: "p", from: "src", to: "copy" }, dir),
      "PROJECT_ENTRY_EXISTS",
    );
  });
});

describe("delete", () => {
  it("deletes recursively without following symlinks", async () => {
    const result = await deleteProjectEntries(
      { projectId: "p", paths: ["src", "link", "missing"] },
      dir,
    );
    assert.deepEqual(result.deleted, ["src", "link"]);
    await assert.rejects(stat(join(root, "src")));
    await stat(join(outside, "secret.txt"));
  });

  it("refuses the root and traversal", async () => {
    await assert.rejects(
      deleteProjectEntries({ projectId: "p", paths: ["src", "."] }, dir),
    );
    await rejects(
      deleteProjectEntries({ projectId: "p", paths: ["link/secret.txt"] }, dir),
      "FILE_PATH_OUTSIDE_PROJECT",
    );
    await stat(join(root, "src"));
  });
});

describe("upload", () => {
  it("writes files, creating nested folders", async () => {
    const { entries } = await uploadProjectFiles(
      {
        projectId: "p",
        path: "src",
        files: [file("n.txt", "n"), file("d/e.txt", "e")],
      },
      dir,
    );
    assert.deepEqual(
      entries.map((entry) => entry.path),
      ["src/n.txt", "src/d/e.txt"],
    );
    assert.equal(await readFile(join(root, "src/d/e.txt"), "utf8"), "e");
  });

  it("fails on conflict without writing anything, unless overwriting", async () => {
    await rejects(
      uploadProjectFiles(
        {
          projectId: "p",
          path: "src",
          files: [file("new.txt", "x"), file("a.txt", "z")],
        },
        dir,
      ),
      "PROJECT_ENTRY_EXISTS",
    );
    await assert.rejects(stat(join(root, "src/new.txt")));
    await uploadProjectFiles(
      {
        projectId: "p",
        path: "src",
        overwrite: true,
        files: [file("a.txt", "z")],
      },
      dir,
    );
    assert.equal(await readFile(join(root, "src/a.txt"), "utf8"), "z");
  });

  it("rejects traversal names and symlinked destinations", async () => {
    await rejects(
      uploadProjectFiles(
        { projectId: "p", path: "", files: [file("../x", "x")] },
        dir,
      ),
      "INVALID_UPLOAD_NAME",
    );
    await rejects(
      uploadProjectFiles(
        { projectId: "p", path: "link", files: [file("x", "x")] },
        dir,
      ),
      "FILE_PATH_OUTSIDE_PROJECT",
    );
  });
});

describe("cached listing paging", () => {
  it("pages with cursors over the cached listing", async () => {
    for (const name of ["c", "b", "a", "d"])
      await writeFile(join(root, `f-${name}`), name);
    const first = await projectDirectoryEntries(
      { projectId: "p", path: "", limit: 3 },
      dir,
    );
    assert.equal(first.entries.length, 3);
    assert.ok(first.nextCursor);
    const second = await projectDirectoryEntries(
      { projectId: "p", path: "", limit: 3, cursor: first.nextCursor },
      dir,
    );
    const names = [...first.entries, ...second.entries].map(
      (entry) => entry.name,
    );
    assert.deepEqual(names, ["src", "f-a", "f-b", "f-c", "f-d", "link"]);
    assert.equal(second.nextCursor, undefined);
  });

  it("uses the native listing and reports ignored", async () => {
    let calls = 0;
    setNativeFilesForTesting({
      listDirectory: async () => {
        calls += 1;
        return [
          { name: "x", path: "x", kind: "file", symlink: false, ignored: true },
          {
            name: "y",
            path: "y",
            kind: "file",
            symlink: false,
            ignored: false,
          },
        ];
      },
      createPathIndex: () => {
        throw new Error("unused");
      },
      searchContent: async () => {
        throw new Error("unused");
      },
    });
    const first = await projectDirectoryEntries(
      { projectId: "p", path: "", limit: 1 },
      dir,
    );
    assert.equal(first.entries[0]?.ignored, true);
    await projectDirectoryEntries(
      { projectId: "p", path: "", limit: 1, cursor: first.nextCursor },
      dir,
    );
    assert.equal(calls, 1);
  });
});
