import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createProjectEntry,
  directoryListing,
  fileContent,
  normalizeIncomingFilePath,
  projectDirectoryEntries,
} from "../src/domains/filesystem/filesystem.service.js";

describe("filesystem application service", () => {
  it("normalizes project-relative and file URL paths", () => {
    assert.equal(
      normalizeIncomingFilePath("/workspace", "src/main.ts", "linux"),
      "/workspace/src/main.ts",
    );
    assert.equal(
      normalizeIncomingFilePath(
        "/workspace",
        "file:///tmp/example.ts",
        "linux",
      ),
      "/tmp/example.ts",
    );
  });

  it("lists directory signals and honors hidden filtering", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-filesystem-service-"));
    await Promise.all([
      mkdir(join(root, "visible")),
      mkdir(join(root, ".hidden")),
      mkdir(join(root, ".git")),
      writeFile(join(root, "package.json"), "{}"),
    ]);
    const visible = await directoryListing(root, false);
    assert.deepEqual(
      visible.entries.map((entry) => entry.name),
      ["visible"],
    );
    assert.deepEqual(visible.signals, ["git", "package"]);
    const all = await directoryListing(root, true);
    assert.deepEqual(
      all.entries.map((entry) => entry.name),
      [".git", ".hidden", "visible"],
    );
  });

  it("creates project files and folders without overwriting or escaping", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-project-create-"));
    const outside = await mkdtemp(join(tmpdir(), "nerve-project-outside-"));
    try {
      await mkdir(join(root, "src"));
      await symlink(outside, join(root, "linked"), "dir");
      const lookup = () => root;

      const file = await createProjectEntry(
        {
          projectId: "project",
          parentPath: "src",
          name: "index.ts",
          kind: "file",
        },
        lookup,
      );
      assert.deepEqual(file.entry, {
        name: "index.ts",
        path: "src/index.ts",
        kind: "file",
        symlink: false,
      });
      const folder = await createProjectEntry(
        { projectId: "project", name: "docs", kind: "directory" },
        lookup,
      );
      assert.equal(folder.entry.path, "docs");

      await assert.rejects(
        createProjectEntry(
          { projectId: "project", name: "docs", kind: "directory" },
          lookup,
        ),
      );
      for (const name of ["../escape", "nested/name", "nested\\name", "."]) {
        await assert.rejects(
          createProjectEntry(
            { projectId: "project", name, kind: "file" },
            lookup,
          ),
          /single path segment/,
        );
      }
      await assert.rejects(
        createProjectEntry(
          {
            projectId: "project",
            parentPath: "../outside",
            name: "escape.txt",
            kind: "file",
          },
          lookup,
        ),
      );
      await assert.rejects(
        createProjectEntry(
          {
            projectId: "project",
            parentPath: "missing",
            name: "file.txt",
            kind: "file",
          },
          lookup,
        ),
      );
      await assert.rejects(
        createProjectEntry(
          {
            projectId: "project",
            parentPath: "linked",
            name: "escape.txt",
            kind: "file",
          },
          lookup,
        ),
        /symbolic link/,
      );
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });

  it("lists all project entries lazily with stable pagination", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-project-entries-"));
    try {
      await Promise.all([
        mkdir(join(root, "node_modules")),
        mkdir(join(root, ".git")),
        mkdir(join(root, "src")),
        writeFile(join(root, ".env"), "secret"),
        writeFile(join(root, "file10.ts"), ""),
        writeFile(join(root, "file2.ts"), ""),
        writeFile(join(root, "src", "nested.ts"), ""),
      ]);

      const lookup = () => root;
      const first = await projectDirectoryEntries(
        { projectId: "project", limit: 3 },
        lookup,
      );
      assert.deepEqual(
        first.entries.map((entry) => entry.name),
        [".git", "node_modules", "src"],
      );
      assert.ok(first.nextCursor);
      const second = await projectDirectoryEntries(
        { projectId: "project", limit: 3, cursor: first.nextCursor },
        lookup,
      );
      assert.deepEqual(
        [...first.entries, ...second.entries].map((entry) => entry.name),
        [".git", "node_modules", "src", ".env", "file2.ts", "file10.ts"],
      );
      assert.equal(second.nextCursor, undefined);

      const nested = await projectDirectoryEntries(
        { projectId: "project", path: "src" },
        lookup,
      );
      assert.deepEqual(
        nested.entries.map((entry) => entry.path),
        ["src/nested.ts"],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe project paths and stale cursors", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-project-paths-"));
    const lookup = () => root;
    try {
      await assert.rejects(
        projectDirectoryEntries(
          { projectId: "project", path: "../other" },
          lookup,
        ),
        /invalid segment|escapes/i,
      );
      await assert.rejects(
        projectDirectoryEntries({ projectId: "project", path: root }, lookup),
        /relative/i,
      );
      await assert.rejects(
        projectDirectoryEntries(
          { projectId: "project", cursor: "not-a-cursor" },
          lookup,
        ),
        /cursor/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("shows links but does not classify links that escape the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-project-links-"));
    const outside = await mkdtemp(join(tmpdir(), "nerve-project-outside-"));
    try {
      await Promise.all([
        writeFile(join(root, "target.txt"), "target"),
        writeFile(join(outside, "outside.txt"), "outside"),
      ]);
      await Promise.all([
        symlink(join(root, "target.txt"), join(root, "inside-link")),
        symlink(join(outside, "outside.txt"), join(root, "outside-link")),
        symlink(join(root, "missing"), join(root, "broken-link")),
      ]);
      const result = await projectDirectoryEntries(
        { projectId: "project" },
        () => root,
      );
      const entries = Object.fromEntries(
        result.entries.map((entry) => [entry.name, entry]),
      );
      assert.deepEqual(entries["inside-link"], {
        name: "inside-link",
        path: "inside-link",
        kind: "file",
        symlink: true,
      });
      assert.equal(entries["outside-link"]?.kind, "other");
      assert.equal(entries["broken-link"]?.kind, "other");
    } finally {
      await Promise.all([
        rm(root, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ]);
    }
  });

  it("reads project files through an injected project-directory lookup", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-filesystem-read-"));
    await writeFile(join(root, "hello.txt"), "hello\nworld");
    const result = await fileContent(
      { projectId: "proj_test", path: "hello.txt" },
      () => root,
    );
    assert.equal(result.type, "text");
    assert.equal(result.text, "hello\nworld");
    assert.equal(result.relativePath, "hello.txt");
  });
});
