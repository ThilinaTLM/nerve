import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findDependencyCycles,
  resolveWorkbenchImport,
  workbenchBoundaryViolation,
} from "./workbench-boundaries.mjs";

const root = "packages/workbench-app/src/lib";

describe("workbench boundaries", () => {
  it("keeps domain and platform below product behavior", () => {
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/domain/events/bus.ts`,
        `${root}/features/tasks/index.ts`,
      ),
      "domain may not depend on features",
    );
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/platform/protocol/client.ts`,
        `${root}/application/startup/start.ts`,
      ),
      "platform may not depend on application",
    );
  });

  it("keeps presentation isolated", () => {
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/presentation/panels/Panel.svelte`,
        `${root}/domain/navigation/types.ts`,
      ),
      "presentation may not depend on domain",
    );
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/presentation/panels/Panel.svelte`,
        `${root}/presentation/panels/model.ts`,
      ),
      undefined,
    );
  });

  it("forbids every direct dependency between distinct features", () => {
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/features/tasks/state/task-tabs.ts`,
        `${root}/features/conversations/index.ts`,
      ),
      "feature tasks may not depend on feature conversations; compose cross-feature workflows in app/composition or application",
    );
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/features/tasks/state/task-tabs.ts`,
        `${root}/features/tasks/api/tasks.ts`,
      ),
      undefined,
    );
  });

  it("requires registered workspace inputs for feature selectors", () => {
    assert.match(
      workbenchBoundaryViolation(
        `${root}/features/tasks/state/task-selectors.svelte.ts`,
        `${root}/application/workspace/workspace-state.svelte.ts`,
      ),
      /registered workspace read models/,
    );
  });

  it("keeps workspace coordination on feature public APIs", () => {
    assert.match(
      workbenchBoundaryViolation(
        `${root}/application/workspace/workspace-selectors.svelte.ts`,
        `${root}/features/git/state/git-state.svelte.ts`,
      ),
      /feature public APIs/,
    );
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/application/workspace/workspace-selectors.svelte.ts`,
        `${root}/features/git`,
      ),
      undefined,
    );
  });

  it("reserves private feature wiring for composition", () => {
    assert.match(
      workbenchBoundaryViolation(
        `${root}/app/shell/Editor.svelte`,
        `${root}/features/git/views/GitPane.svelte`,
      ),
      /public APIs/,
    );
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/app/composition/views.ts`,
        `${root}/features/git/views/GitPane.svelte`,
      ),
      undefined,
    );
  });

  it("finds strongly connected dependency components", () => {
    const graph = new Map([
      ["app", new Set(["feature"])],
      ["feature", new Set(["application"])],
      ["application", new Set(["feature"])],
      ["domain", new Set()],
    ]);
    assert.deepEqual(findDependencyCycles(graph), [["application", "feature"]]);
  });

  it("resolves aliases and relative paths", () => {
    assert.equal(
      resolveWorkbenchImport(
        `${root}/app/shell/Editor.svelte`,
        "$lib/features/git",
      ),
      `${root}/features/git`,
    );
    assert.equal(
      resolveWorkbenchImport(
        `${root}/app/shell/Editor.svelte`,
        "../../domain/navigation/types",
      ),
      `${root}/domain/navigation/types`,
    );
  });
});
