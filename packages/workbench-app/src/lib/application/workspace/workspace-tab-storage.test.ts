import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readWorkspaceTabStorage,
  WORKSPACE_TAB_STORAGE_KEY,
} from "./workspace-tab-storage.js";

test("migrates launch tab identities and MRU without changing other tabs or metadata", () => {
  const legacy = {
    selectedProjectKey: "task_project",
    projectRecency: { task_project: 123 },
    sessions: {
      task_project: {
        tabs: [
          { kind: "task", id: "task_1" },
          { kind: "task", id: "taskdef_2" },
          { kind: "task", id: "taskgrp_3" },
          { kind: "file", id: "task_file", path: "tasks/readme.md" },
        ],
        active: { kind: "task", id: "taskdef_2" },
        mru: [
          "task:taskdef_2",
          "task:task_1",
          "task:taskgrp_3",
          "file:task_file",
        ],
      },
    },
    globals: [{ kind: "logs", id: "logs" }],
  };
  const values = new Map([["nerve.workspaceTabs.v2", JSON.stringify(legacy)]]);
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
    ...legacy,
    sessions: {
      task_project: {
        tabs: [
          { kind: "launch", id: "launch_1" },
          { kind: "launch", id: "launchdef_2" },
          { kind: "launch", id: "launchgrp_3" },
          legacy.sessions.task_project.tabs[3],
        ],
        active: { kind: "launch", id: "launchdef_2" },
        mru: [
          "launch:launchdef_2",
          "launch:launch_1",
          "launch:launchgrp_3",
          "file:task_file",
        ],
      },
    },
  };
  assert.deepEqual(readWorkspaceTabStorage(storage), expected);
  assert.equal(values.has("nerve.workspaceTabs.v2"), false);
  assert.deepEqual(
    JSON.parse(values.get(WORKSPACE_TAB_STORAGE_KEY)!),
    expected,
  );
  values.set("nerve.workspaceTabs.v2", JSON.stringify(legacy));
  assert.deepEqual(readWorkspaceTabStorage(storage), expected);
  assert.equal(values.has("nerve.workspaceTabs.v2"), false);
});

test("keeps legacy tabs when migration cannot be persisted", () => {
  let removed = false;
  assert.equal(
    readWorkspaceTabStorage({
      getItem: (key) =>
        key === "nerve.workspaceTabs.v2" ? '{"globals":[]}' : null,
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

test("missing or malformed tabs use hydration defaults", () => {
  for (const value of [null, "{"]) {
    assert.equal(
      readWorkspaceTabStorage({
        getItem: (key) => (key === "nerve.workspaceTabs.v2" ? value : null),
        setItem: () => assert.fail("must not write"),
        removeItem: () => assert.fail("must not remove"),
      }),
      undefined,
    );
  }
});
