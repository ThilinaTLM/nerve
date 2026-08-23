import type {
  PermissionException,
  ProjectPermissions,
  ProjectRecord,
} from "$lib/api";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

Object.assign(globalThis, {
  $state: <Value>(value?: Value) => value,
});

const { PermissionsPageState } =
  await import("./permissions-page-state.svelte");

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function project(id: string): ProjectRecord {
  return { id, name: id } as ProjectRecord;
}

function permissions(...exceptions: PermissionException[]): ProjectPermissions {
  return { version: 1, exceptions };
}

function blockedPath(id: string, pattern: string): PermissionException {
  return {
    id,
    effect: "deny",
    selector: { kind: "path_glob", access: "read_write", pattern },
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("PermissionsPageState", () => {
  it("ignores stale project loads while switching scope", async () => {
    const loads = new Map<
      string,
      ReturnType<typeof deferred<ProjectPermissions>>
    >();
    const state = new PermissionsPageState({
      getProject: (projectId) => {
        const load = deferred<ProjectPermissions>();
        loads.set(projectId, load);
        return load.promise;
      },
      updateProject: async (_projectId, value) => value,
      updateGlobal: async () => {},
    });

    state.selectProject(project("project_a"));
    state.selectProject(project("project_b"));
    loads
      .get("project_b")
      ?.resolve(permissions(blockedPath("exception_b", "b/**")));
    await settle();
    assert.equal(state.project?.id, "project_b");
    assert.equal(state.projectPermissions?.exceptions[0]?.id, "exception_b");
    assert.equal(state.loading, false);

    loads
      .get("project_a")
      ?.resolve(permissions(blockedPath("exception_a", "a/**")));
    await settle();
    assert.equal(state.projectPermissions?.exceptions[0]?.id, "exception_b");

    state.selectProject(undefined);
    assert.equal(state.scope, "global");
    assert.equal(state.projectPermissions, undefined);
  });

  it("surfaces load failures and retries the active project", async () => {
    let calls = 0;
    const state = new PermissionsPageState({
      getProject: async () => {
        calls += 1;
        if (calls === 1) throw new Error("Temporary failure");
        return permissions(blockedPath("exception_retry", "retry/**"));
      },
      updateProject: async (_projectId, value) => value,
      updateGlobal: async () => {},
    });

    state.selectProject(project("project_retry"));
    await settle();
    assert.equal(state.error, "Temporary failure");

    state.retry();
    await settle();
    assert.equal(calls, 2);
    assert.equal(state.error, undefined);
    assert.equal(
      state.projectPermissions?.exceptions[0]?.id,
      "exception_retry",
    );
  });

  it("keeps project state authoritative across successful and failed changes", async () => {
    let fail = false;
    const state = new PermissionsPageState({
      getProject: async () => permissions(),
      updateProject: async (_projectId, value) => {
        if (fail) throw new Error("Project save failed");
        return value;
      },
      updateGlobal: async () => {},
    });
    state.selectProject(project("project_changes"));
    await settle();

    const first = blockedPath("exception_first", "first/**");
    assert.equal(await state.add(first, []), true);
    assert.deepEqual(state.projectPermissions?.exceptions, [first]);

    fail = true;
    const second = blockedPath("exception_second", "second/**");
    assert.equal(await state.add(second, []), false);
    assert.deepEqual(state.projectPermissions?.exceptions, [first]);
    assert.equal(state.error, "Project save failed");

    fail = false;
    await state.remove(first.id, []);
    assert.deepEqual(state.projectPermissions?.exceptions, []);

    await state.add(first, []);
    fail = true;
    await state.remove(first.id, []);
    assert.deepEqual(state.projectPermissions?.exceptions, [first]);
    assert.equal(state.error, "Project save failed");
    assert.deepEqual(state.pendingIds, []);
  });

  it("waits for global persistence before applying removals and reports failure", async () => {
    const save = deferred<void>();
    let persisted = [blockedPath("exception_global", "global/**")];
    let fail = false;
    const state = new PermissionsPageState({
      getProject: async () => permissions(),
      updateProject: async (_projectId, value) => value,
      updateGlobal: async (exceptions) => {
        await save.promise;
        if (fail) throw new Error("Global save failed");
        persisted = exceptions;
      },
    });

    const removing = state.remove("exception_global", persisted);
    assert.equal(state.pendingIds.includes("exception_global"), true);
    assert.equal(persisted.length, 1);
    save.resolve();
    await removing;
    assert.deepEqual(persisted, []);
    assert.deepEqual(state.pendingIds, []);

    const existing = blockedPath("exception_existing", "existing/**");
    persisted = [existing];
    fail = true;
    await state.remove(existing.id, persisted);
    assert.deepEqual(persisted, [existing]);
    assert.equal(state.error, "Global save failed");
  });
});
