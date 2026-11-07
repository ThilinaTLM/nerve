import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "@nervekit/contracts/core";
import { projectKey } from "$lib/domain/projects/project-tree";
import { WORKSPACE_TAB_STORAGE_KEY } from "./workspace-tab-storage";

// Only plain state is needed; no reactive runtime.
Object.defineProperty(globalThis, "$state", {
  configurable: true,
  value: <T>(value: T): T => value,
});
const { hydrateWorkspaceTabSessions, removeTabsFromAllSessions } =
  await import("./workspace-tab-sessions");
const { workspaceState } = await import("./workspace-state.svelte");
Reflect.deleteProperty(globalThis, "$state");

test("startup cleanup does not overwrite the selected project's stored tabs", () => {
  const project = { id: "proj_a", dir: "/tmp/a" } as unknown as Project;
  const key = projectKey(project);
  const tab = { kind: "conversation", id: "conv_1" } as const;
  const session = { tabs: [tab], active: tab, mru: ["conversation:conv_1"] };
  const values = new Map([
    [
      WORKSPACE_TAB_STORAGE_KEY,
      JSON.stringify({ selectedProjectKey: key, sessions: { [key]: session } }),
    ],
  ]);
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
  };
  try {
    hydrateWorkspaceTabSessions(
      { projects: [project], conversations: [], launches: [] },
      { deferActivation: true },
    );
    assert.equal(workspaceState.selectedProjectKey, key);
    assert.equal(workspaceState.selectedProjectId, undefined);

    removeTabsFromAllSessions(() => false);

    assert.deepEqual(workspaceState.projectTabSessions[key]?.tabs, [tab]);
    const persisted = JSON.parse(values.get(WORKSPACE_TAB_STORAGE_KEY)!);
    assert.deepEqual(persisted.sessions[key].tabs, [tab]);
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});
