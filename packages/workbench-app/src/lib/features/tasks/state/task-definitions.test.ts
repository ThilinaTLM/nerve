import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TaskDefinition } from "$lib/api";
import { createTaskDefinitionStore } from "./task-definitions.svelte";

function definition(
  id: string,
  projectId = "proj_a",
  command = "pnpm test",
): TaskDefinition {
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

describe("task definition store", () => {
  it("deduplicates concurrent project loads", async () => {
    const request = deferred<TaskDefinition[]>();
    let calls = 0;
    const store = createTaskDefinitionStore(() => {
      calls += 1;
      return request.promise;
    });

    const first = store.load("proj_a");
    const second = store.load("proj_a");
    assert.equal(calls, 1);
    request.resolve([definition("taskdef_one")]);
    await Promise.all([first, second]);
    assert.deepEqual(store.cached("proj_a"), [definition("taskdef_one")]);
  });

  it("loads different projects concurrently", async () => {
    const requests = new Map<
      string,
      ReturnType<typeof deferred<TaskDefinition[]>>
    >();
    const store = createTaskDefinitionStore((projectId) => {
      const request = deferred<TaskDefinition[]>();
      requests.set(projectId, request);
      return request.promise;
    });

    const a = store.load("proj_a");
    const b = store.load("proj_b");
    assert.equal(requests.size, 2);
    requests.get("proj_a")?.resolve([definition("taskdef_a", "proj_a")]);
    requests.get("proj_b")?.resolve([definition("taskdef_b", "proj_b")]);
    await Promise.all([a, b]);
  });

  it("retains cached data after failure and permits retry", async () => {
    let attempt = 0;
    const store = createTaskDefinitionStore(async () => {
      attempt += 1;
      if (attempt === 2) throw new Error("offline");
      return [definition("taskdef_one", "proj_a", `command-${attempt}`)];
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
    const store = createTaskDefinitionStore(async () => {
      calls += 1;
      return [];
    });
    const first = definition("taskdef_one");
    const updated = definition("taskdef_one", "proj_a", "pnpm check");

    store.upsert("proj_a", first);
    store.upsert("proj_a", updated);
    assert.deepEqual(store.cached("proj_a"), [updated]);
    store.remove(first.id);
    assert.deepEqual(store.cached("proj_a"), []);
    assert.equal(calls, 0);
  });
});
