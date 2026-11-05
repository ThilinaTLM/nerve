import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  clearProjectListingCache,
  projectDirectoryEntries,
} from "./project-listing.js";

async function list(root: string, path?: string) {
  const { entries } = await projectDirectoryEntries(
    { projectId: "p", path },
    () => root,
  );
  return entries;
}

void test("listing is cached per project root and path, not per directory alone", async () => {
  clearProjectListingCache();
  const root = await mkdtemp(join(tmpdir(), "listing-root-"));
  try {
    await mkdir(join(root, "sub"));
    await writeFile(join(root, "sub", "a.txt"), "a");
    const nested = join(root, "sub");
    const fromParent = await list(root, "sub");
    const fromNested = await list(nested);
    assert.equal(fromParent[0]?.path, "sub/a.txt");
    assert.equal(fromNested[0]?.path, "a.txt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test("editing .gitignore refreshes cached ignored flags without waiting for expiry", async () => {
  clearProjectListingCache();
  const root = await mkdtemp(join(tmpdir(), "listing-ignore-"));
  try {
    await writeFile(join(root, "keep.txt"), "k");
    await writeFile(join(root, "gen.txt"), "g");
    await writeFile(join(root, ".gitignore"), "");
    // Settle the directory mtime so the first listing is cacheable.
    const old = new Date(Date.now() - 60_000);
    await utimes(root, old, old);
    const before = await list(root);
    const gen = before.find((entry) => entry.name === "gen.txt");
    if (gen?.ignored === undefined) return; // Node fallback: no ignore rules.
    assert.equal(gen.ignored, false);

    await writeFile(join(root, ".gitignore"), "gen.txt\n");
    await utimes(root, old, old); // The edit does not touch the directory.
    const after = await list(root);
    assert.equal(
      after.find((entry) => entry.name === "gen.txt")?.ignored,
      true,
    );
    assert.equal(
      after.find((entry) => entry.name === "keep.txt")?.ignored,
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
