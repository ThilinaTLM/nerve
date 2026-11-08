import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capGitProjectEntries,
  defaultGitPanelLayout,
  defaultGitProjectPreferences,
  loadGitPanelLayout,
  loadGitProjectPreferences,
  persistGitPanelLayout,
  persistGitProjectPreferences,
  pruneGitProjectPreferences,
  type GitPanelPreferenceStorage,
} from "./git-panel-preferences.js";

class MemoryStorage implements GitPanelPreferenceStorage {
  readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
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

test("missing or corrupt project preferences fall back to defaults", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(
    loadGitProjectPreferences("proj_a", storage),
    defaultGitProjectPreferences(),
  );
  storage.setItem("nerve:git-panel:v1:proj_a", "{nope");
  assert.deepEqual(
    loadGitProjectPreferences("proj_a", storage),
    defaultGitProjectPreferences(),
  );
  storage.setItem(
    "nerve:git-panel:v1:proj_a",
    JSON.stringify({ filter: 7, expanded: "x", selected: 3 }),
  );
  assert.deepEqual(
    loadGitProjectPreferences("proj_a", storage),
    defaultGitProjectPreferences(),
  );
});

test("project preferences round-trip per project", () => {
  const storage = new MemoryStorage();
  persistGitProjectPreferences(
    "proj_a",
    { filter: "attention", expanded: ["g1", "g1", "g2"], selected: "api" },
    storage,
  );
  assert.deepEqual(loadGitProjectPreferences("proj_a", storage), {
    filter: "attention",
    expanded: ["g1", "g2"],
    selected: "api",
  });
  assert.deepEqual(
    loadGitProjectPreferences("proj_b", storage),
    defaultGitProjectPreferences(),
  );
});

test("pruning forgets repositories and worktrees discovery no longer returns", () => {
  const pruned = pruneGitProjectPreferences(
    { filter: "changed", expanded: ["a", "gone"], selected: "gone/wt" },
    { groups: new Set(["a", "b"]), worktrees: new Set(["a", "b"]) },
  );
  assert.deepEqual(pruned, {
    filter: "changed",
    expanded: ["a"],
    selected: null,
  });
  assert.equal(
    pruneGitProjectPreferences(defaultGitProjectPreferences(), {
      groups: new Set(),
      worktrees: new Set(),
    }).expanded,
    null,
  );
});

test("project entries are capped, dropping the least recently written", () => {
  const storage = new MemoryStorage();
  for (let index = 0; index < 5; index++)
    persistGitProjectPreferences(
      `proj_${index}`,
      defaultGitProjectPreferences(),
      storage,
      1_000 + index,
    );
  storage.setItem("nerve:git-panel-layout:v3", "{}");
  capGitProjectEntries(storage, 3);
  const keys = [...storage.values.keys()].sort();
  assert.deepEqual(keys, [
    "nerve:git-panel-layout:v3",
    "nerve:git-panel:v1:proj_2",
    "nerve:git-panel:v1:proj_3",
    "nerve:git-panel:v1:proj_4",
  ]);
});

test("layout is validated and clamped", () => {
  const storage = new MemoryStorage();
  assert.deepEqual(loadGitPanelLayout(storage), defaultGitPanelLayout());
  storage.setItem(
    "nerve:git-panel-layout:v3",
    JSON.stringify({
      listSize: 5,
      branch: { collapsed: true, size: "x" },
      changes: "x",
    }),
  );
  assert.deepEqual(loadGitPanelLayout(storage), {
    listSize: 0.9,
    branch: { collapsed: true, size: null },
    changes: defaultGitPanelLayout().changes,
  });
  persistGitPanelLayout(
    {
      listSize: null,
      branch: { collapsed: false, size: 0.3 },
      changes: { collapsed: false },
    },
    storage,
  );
  assert.equal(loadGitPanelLayout(storage).branch.size, 0.3);
});
