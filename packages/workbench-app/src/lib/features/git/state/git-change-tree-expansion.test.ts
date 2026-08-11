import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gitChangeTreeExpansionStorageKey,
  loadCollapsedGitFolders,
  sanitizeCollapsedGitFolders,
  saveCollapsedGitFolders,
} from "./git-change-tree-expansion.js";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

test("sanitizes, deduplicates, and bounds collapsed folder keys", () => {
  const values = Array.from({ length: 2_100 }, (_, index) => `folder:${index}`);
  assert.equal(sanitizeCollapsedGitFolders([...values, "", 4]).length, 2_000);
  assert.deepEqual(sanitizeCollapsedGitFolders(["one", "one", "two"]), [
    "one",
    "two",
  ]);
  assert.deepEqual(sanitizeCollapsedGitFolders({}), []);
});

test("round-trips per project and repository and removes empty state", () => {
  const storage = new MemoryStorage();
  saveCollapsedGitFolders("proj_one", ".", ["unstaged:src"], storage);
  saveCollapsedGitFolders("proj_one", "nested", ["staged:lib"], storage);

  assert.deepEqual(loadCollapsedGitFolders("proj_one", ".", storage), [
    "unstaged:src",
  ]);
  assert.deepEqual(loadCollapsedGitFolders("proj_one", "nested", storage), [
    "staged:lib",
  ]);
  assert.notEqual(
    gitChangeTreeExpansionStorageKey("proj_one", "."),
    gitChangeTreeExpansionStorageKey("proj_one", "nested"),
  );

  saveCollapsedGitFolders("proj_one", ".", [], storage);
  assert.equal(
    storage.getItem(gitChangeTreeExpansionStorageKey("proj_one", ".")),
    null,
  );
});

test("falls back safely for corrupt persisted state", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    gitChangeTreeExpansionStorageKey("proj_one", "."),
    "not-json",
  );
  assert.deepEqual(loadCollapsedGitFolders("proj_one", ".", storage), []);
});
