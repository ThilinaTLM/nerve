import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LaunchDefinition } from "$lib/api";
import { createLaunchDefinitionStore } from "./launch-definitions.svelte";

function definition(
  id: string,
  projectId = "proj_a",
  command = "pnpm test",
): LaunchDefinition {
  return {
    id,
    scope: { kind: "project", projectId },
    command,
    runPolicy: "single",
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("launch definition store", () => {
  it("deduplicates concurrent project loads", async () => {
    const request = deferred<LaunchDefinition[]>();
    let calls = 0;
    const store = createLaunchDefinitionStore(() => {
      calls += 1;
      return request.promise;
    });

    const first = store.load("proj_a");
    const second = store.load("proj_a");
    assert.equal(calls, 1);
    request.resolve([definition("launchdef_one")]);
    await Promise.all([first, second]);
    assert.deepEqual(store.cached("proj_a"), [definition("launchdef_one")]);
  });

  it("loads different projects concurrently", async () => {
    const requests = new Map<
      string,
      ReturnType<typeof deferred<LaunchDefinition[]>>
    >();
    const store = createLaunchDefinitionStore((projectId) => {
      const request = deferred<LaunchDefinition[]>();
      requests.set(projectId, request);
      return request.promise;
    });

    const a = store.load("proj_a");
    const b = store.load("proj_b");
    assert.equal(requests.size, 2);
    requests.get("proj_a")?.resolve([definition("launchdef_a", "proj_a")]);
    requests.get("proj_b")?.resolve([definition("launchdef_b", "proj_b")]);
    await Promise.all([a, b]);
  });

  it("retains cached data after failure and permits retry", async () => {
    let attempt = 0;
    const store = createLaunchDefinitionStore(async () => {
      attempt += 1;
      if (attempt === 2) throw new Error("offline");
      return [definition("launchdef_one", "proj_a", `command-${attempt}`)];
    });

    await store.load("proj_a");
    const cached = store.cached("proj_a");
    await assert.rejects(store.load("proj_a"), /offline/);
    assert.equal(store.cached("proj_a"), cached);
    await store.load("proj_a");
    assert.equal(store.cached("proj_a")?.[0]?.command, "command-3");
  });

  it("updates and removes cached definitions without fetching", () => {
    let calls = 0;
    const store = createLaunchDefinitionStore(async () => {
      calls += 1;
      return [];
    });
    const first = definition("launchdef_one");
    const updated = definition("launchdef_one", "proj_a", "pnpm check");

    store.upsert("proj_a", first);
    store.upsert("proj_a", updated);
    assert.deepEqual(store.cached("proj_a"), [updated]);
    store.remove(first.id);
    assert.deepEqual(store.cached("proj_a"), []);
    assert.equal(calls, 0);
  });
});
