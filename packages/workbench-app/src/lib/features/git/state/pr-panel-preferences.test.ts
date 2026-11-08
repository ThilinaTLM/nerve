import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultPrPanelPreferences,
  loadPrPanelPreferences,
  persistPrPanelPreferences,
  prPanelPreferencesKey,
} from "./pr-panel-preferences.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

test("defaults for missing, corrupt or invalid values", () => {
  const key = prPanelPreferencesKey("proj_a");
  assert.equal(key, "nerve:git-pr-panel:v1:proj_a");
  assert.deepEqual(
    loadPrPanelPreferences("proj_a", memoryStorage()),
    defaultPrPanelPreferences,
  );
  assert.deepEqual(
    loadPrPanelPreferences("proj_a", memoryStorage({ [key]: "{nope" })),
    defaultPrPanelPreferences,
  );
  assert.deepEqual(
    loadPrPanelPreferences(
      "proj_a",
      memoryStorage({
        [key]: JSON.stringify({
          quick: "everyone",
          filters: { drafts: 3, labels: ["bug", 4, " bug "], sort: "x" },
        }),
      }),
    ),
    {
      quick: "all",
      filters: { drafts: "include", labels: ["bug"], sort: "updated-desc" },
    },
  );
});

test("round trips per project", () => {
  const storage = memoryStorage();
  const prefs = {
    quick: "review" as const,
    filters: {
      drafts: "exclude" as const,
      labels: ["bug"],
      sort: "updated-asc" as const,
    },
  };
  persistPrPanelPreferences("proj_a", prefs, storage);
  assert.deepEqual(loadPrPanelPreferences("proj_a", storage), prefs);
  assert.deepEqual(
    loadPrPanelPreferences("proj_b", storage),
    defaultPrPanelPreferences,
  );
});
