import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  directDirectoryCompletionItems,
  discoverCandidates,
} from "../../src/domains/completions/file-completion-candidates.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-file-completions-"));
  roots.push(root);
  await Promise.all([
    mkdir(join(root, "src", "nested"), { recursive: true }),
    mkdir(join(root, "node_modules", "dependency"), { recursive: true }),
    mkdir(join(root, "dist"), { recursive: true }),
    mkdir(join(root, ".github"), { recursive: true }),
    mkdir(join(root, "empty"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, "src", "nested", "useful.ts"), "export {};"),
    writeFile(join(root, "src", "compiled.wasm"), "binary"),
    writeFile(join(root, "node_modules", "dependency", "index.js"), ""),
    writeFile(join(root, "dist", "bundle.js"), ""),
    writeFile(join(root, ".github", "workflows.yml"), ""),
    writeFile(join(root, "README.md"), ""),
  ]);
  try {
    await symlink(join(root, "src"), join(root, "linked-src"), "dir");
  } catch {
    // Windows may not grant symlink privileges to the test process.
  }
  return root;
}

describe("file completion candidate discovery", () => {
  it("uses the bounded fallback while pruning generated trees and binaries", async () => {
    const root = await fixture();
    const candidates = await discoverCandidates(root);
    const paths = candidates.map((candidate) => candidate.relativePath);

    assert.equal(paths.includes("src/nested/useful.ts"), true);
    assert.equal(paths.includes("src/nested"), true);
    assert.equal(paths.includes(".github/workflows.yml"), true);
    assert.equal(
      paths.some((path) => path.includes("node_modules")),
      false,
    );
    assert.equal(
      paths.some((path) => path.startsWith("dist")),
      false,
    );
    assert.equal(paths.includes("src/compiled.wasm"), false);
    assert.equal(
      paths.some((path) => path.startsWith("linked-src")),
      false,
    );
  });

  it("keeps direct navigation live, ordered, safe, and capped", async () => {
    const root = await fixture();
    const rootItems = await directDirectoryCompletionItems(root, "", 8);
    const sourceItems = await directDirectoryCompletionItems(root, "src/", 8);

    assert.equal(rootItems[0]?.kind, "directory");
    assert.equal(
      rootItems.some((item) => item.info === "node_modules"),
      false,
    );
    assert.equal(
      rootItems.some((item) => item.info === "dist"),
      false,
    );
    assert.equal(
      rootItems.some((item) => item.info === "empty"),
      true,
    );
    assert.equal(
      sourceItems.some((item) => item.info === "src/compiled.wasm"),
      false,
    );
    assert.deepEqual(await directDirectoryCompletionItems(root, "../", 8), []);
  });
});
