import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  PermissionOverlay,
  PermissionPolicyConfiguration,
  ProjectRecord,
} from "$lib/api";
Object.assign(globalThis, {
  $state: <Value>(value?: Value) => value,
});

const { PermissionsPageState } =
  await import("./permissions-page-state.svelte.js");

const project: ProjectRecord = {
  id: "proj_test",
  name: "Test",
  dir: "/workspace",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const emptyOverlay: PermissionOverlay = { schemaVersion: 1, rules: [] };
const configuration: PermissionPolicyConfiguration = {
  ruleSets: [],
  userOverlay: emptyOverlay,
  projectOverlay: emptyOverlay,
  projectTrust: { status: "missing" },
  diagnostics: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("PermissionsPageState", () => {
  it("ignores a stale project load", async () => {
    const first = deferred<PermissionPolicyConfiguration>();
    const second = deferred<PermissionPolicyConfiguration>();
    const state = new PermissionsPageState({
      getConfiguration: (id) =>
        id === "proj_test" ? first.promise : second.promise,
      updateOverlay: async (_id, _scope, overlay) => overlay,
      updateTrust: async () => undefined,
    });
    state.selectProject(project);
    state.selectProject({ ...project, id: "proj_other" });
    second.resolve(configuration);
    await second.promise;
    await Promise.resolve();
    first.resolve({ ...configuration, diagnostics: ["stale"] });
    await first.promise;
    await Promise.resolve();
    assert.deepEqual(state.configuration?.diagnostics, []);
  });

  it("adds and removes canonical rules through one overlay", async () => {
    let saved: PermissionOverlay = emptyOverlay;
    const state = new PermissionsPageState({
      getConfiguration: async () => configuration,
      updateOverlay: async (_id, _scope, overlay) => {
        saved = overlay;
        return overlay;
      },
      updateTrust: async () => undefined,
    });
    state.selectProject(project);
    await Promise.resolve();
    await Promise.resolve();
    const rule = {
      id: "allow-write",
      enabled: true,
      priority: 0,
      enforcement: "overridable" as const,
      when: { toolNames: ["write"] },
      decision: "allow" as const,
    };
    assert.equal(await state.add("user", rule), true);
    assert.equal(saved.rules[0]?.id, "allow-write");
    await state.remove("user", "allow-write");
    assert.deepEqual(saved.rules, []);
  });

  it("refreshes project trust after a trust mutation", async () => {
    let trusted = false;
    const state = new PermissionsPageState({
      getConfiguration: async () => ({
        ...configuration,
        projectTrust: { status: trusted ? "trusted" : "untrusted" },
      }),
      updateOverlay: async (_id, _scope, overlay) => overlay,
      updateTrust: async (_id, value) => {
        trusted = value;
      },
    });
    state.selectProject(project);
    await Promise.resolve();
    await Promise.resolve();
    await state.setTrusted(true);
    assert.equal(state.configuration?.projectTrust.status, "trusted");
  });
});
