import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProjectColumnPreferences,
  parseProjectColumnPreferences,
  persistProjectColumnPreferences,
} from "./project-columns";

test("project columns are off unless a page was switched on", () => {
  assert.deepEqual(parseProjectColumnPreferences(null), {
    general: false,
    tools: false,
  });
  assert.deepEqual(
    parseProjectColumnPreferences({ general: true, tools: "yes" }),
    { general: true, tools: false },
  );
});

test("project column choices are remembered per page", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  persistProjectColumnPreferences({ general: false, tools: true }, storage);
  assert.deepEqual(loadProjectColumnPreferences(storage), {
    general: false,
    tools: true,
  });
});
