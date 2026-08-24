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
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function project(id: string): ProjectRecord {
  return { id, name: id } as ProjectRecord;
}

function permissions(...exceptions: PermissionException[]): ProjectPermissions {
  return { version: 2, exceptions };
}

function blockedPath(id: string, rule: string): PermissionException {
  return { id, tool: "read", effect: "deny", rule };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    getProject: async () => permissions(),
    updateProject: async (_projectId: string, value: ProjectPermissions) =>
      value,
    updateUser: async () => {},
    listTools: async () => [],
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("PermissionsPageState", () => {
  it("ignores stale project loads while retaining the independent user scope", async () => {
    const loads = new Map<
      string,
      ReturnType<typeof deferred<ProjectPermissions>>
    >();
    const state = new PermissionsPageState(
      dependencies({
        getProject: (projectId: string) => {
          const load = deferred<ProjectPermissions>();
          loads.set(projectId, load);
          return load.promise;
        },
      }),
    );

    state.selectProject(project("project_a"));
    state.selectProject(project("project_b"));
    loads
      .get("project_b")
      ?.resolve(permissions(blockedPath("exception_b", "b/**")));
    await settle();
    assert.equal(state.project?.id, "project_b");
    assert.equal(state.projectPermissions?.exceptions[0]?.id, "exception_b");
    assert.equal(state.projectLoading, false);

    loads
      .get("project_a")
      ?.resolve(permissions(blockedPath("exception_a", "a/**")));
    await settle();
    assert.equal(state.projectPermissions?.exceptions[0]?.id, "exception_b");

    state.selectProject(undefined);
    assert.equal(state.projectPermissions, undefined);
    assert.equal(state.error("user"), undefined);
  });

  it("surfaces project load failures and retries the active project", async () => {
    let calls = 0;
    const state = new PermissionsPageState(
      dependencies({
        getProject: async () => {
          calls += 1;
          if (calls === 1) throw new Error("Temporary failure");
          return permissions(blockedPath("exception_retry", "retry/**"));
        },
      }),
    );

    state.selectProject(project("project_retry"));
    await settle();
    assert.equal(state.projectError, "Temporary failure");
    state.retryProject();
    await settle();
    assert.equal(calls, 2);
    assert.equal(state.projectError, undefined);
  });

  it("keeps project changes authoritative and errors isolated by scope", async () => {
    let fail = false;
    const state = new PermissionsPageState(
      dependencies({
        updateProject: async (
          _projectId: string,
          value: ProjectPermissions,
        ) => {
          if (fail) throw new Error("Project save failed");
          return value;
        },
      }),
    );
    state.selectProject(project("project_changes"));
    await settle();

    const first = blockedPath("exception_first", "first/**");
    assert.equal(await state.add("project", first, []), true);
    assert.deepEqual(state.projectPermissions?.exceptions, [first]);

    fail = true;
    const second = blockedPath("exception_second", "second/**");
    assert.equal(await state.add("project", second, []), false);
    assert.deepEqual(state.projectPermissions?.exceptions, [first]);
    assert.equal(state.projectError, "Project save failed");
    assert.equal(state.userError, undefined);
  });

  it("tracks user persistence independently and rejects duplicates per scope", async () => {
    const save = deferred<void>();
    let persisted = [blockedPath("exception_user", "user/**")];
    const state = new PermissionsPageState(
      dependencies({
        updateUser: async (exceptions: PermissionException[]) => {
          await save.promise;
          persisted = exceptions;
        },
      }),
    );

    const removing = state.remove("user", "exception_user", persisted);
    assert.equal(state.isPending("user", "exception_user"), true);
    assert.equal(state.isPending("project", "exception_user"), false);
    save.resolve();
    await removing;
    assert.deepEqual(persisted, []);

    const existing = blockedPath("exception_existing", "same/**");
    assert.equal(
      await state.add("user", blockedPath("exception_other", "same/**"), [
        existing,
      ]),
      false,
    );
    assert.match(state.userError ?? "", /already exists/);
  });
});
