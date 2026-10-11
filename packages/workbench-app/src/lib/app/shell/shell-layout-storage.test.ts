import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readShellLayoutStorage,
  SHELL_LAYOUT_STORAGE_KEY,
} from "./shell-layout-storage.js";

test("migrates dock views, active and hidden IDs once", () => {
  const values = new Map([
    [
      "nerve.layout.v1",
      JSON.stringify({
        docks: {
          left: {
            views: ["conversations", "tasks"],
            activeViewId: "tasks",
            size: 25,
          },
          bottom: { views: [], collapsed: true },
        },
        hidden: ["tasks"],
      }),
    ],
  ]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const expected = {
    docks: {
      left: {
        views: ["conversations", "launches"],
        activeViewId: "launches",
        size: 25,
      },
      bottom: { views: [], collapsed: true },
    },
    hidden: ["launches"],
  };
  assert.deepEqual(readShellLayoutStorage(storage), expected);
  assert.equal(values.has("nerve.layout.v1"), false);
  assert.deepEqual(JSON.parse(values.get(SHELL_LAYOUT_STORAGE_KEY)!), expected);
  values.set("nerve.layout.v1", JSON.stringify({ hidden: ["tasks"] }));
  assert.deepEqual(readShellLayoutStorage(storage), expected);
  assert.equal(values.has("nerve.layout.v1"), false);
});

test("keeps legacy layout when migration cannot be persisted", () => {
  let removed = false;
  assert.equal(
    readShellLayoutStorage({
      getItem: (key) =>
        key === "nerve.layout.v1" ? '{"hidden":["tasks"]}' : null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        removed = true;
      },
    }),
    undefined,
  );
  assert.equal(removed, false);
});

test("missing or malformed layout uses hydration defaults", () => {
  for (const value of [null, "{"]) {
    assert.equal(
      readShellLayoutStorage({
        getItem: (key) => (key === "nerve.layout.v1" ? value : null),
        setItem: () => assert.fail("must not write"),
        removeItem: () => assert.fail("must not remove"),
      }),
      undefined,
    );
  }
});
