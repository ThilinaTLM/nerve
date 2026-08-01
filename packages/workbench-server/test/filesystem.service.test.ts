import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  directoryListing,
  fileContent,
  normalizeIncomingFilePath,
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
