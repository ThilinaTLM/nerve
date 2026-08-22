import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findDependencyCycles,
  resolveWorkbenchImport,
  workbenchBoundaryViolation,
} from "./workbench-boundaries.mjs";

const root = "packages/workbench-app/src/lib";

describe("workbench boundaries", () => {
  it("keeps kernel and platform below product behavior", () => {
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/kernel/events/bus.ts`,
        `${root}/features/tasks/index.ts`,
      ),
      "kernel may not depend on features",
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
        `${root}/presentation/panel/Panel.svelte`,
        `${root}/kernel/navigation/types.ts`,
      ),
      "presentation may not depend on kernel",
    );
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/presentation/panel/Panel.svelte`,
        `${root}/presentation/panel/model.ts`,
      ),
      undefined,
    );
  });

  it("reserves private feature wiring for composition", () => {
    assert.match(
      workbenchBoundaryViolation(
        `${root}/app/shell/Editor.svelte`,
        `${root}/features/git/ui/GitPane.svelte`,
      ),
      /public APIs/,
    );
    assert.equal(
      workbenchBoundaryViolation(
        `${root}/app/composition/views.ts`,
        `${root}/features/git/ui/GitPane.svelte`,
      ),
      undefined,
    );
  });

  it("finds strongly connected dependency components", () => {
    const graph = new Map([
      ["app", new Set(["feature"])],
      ["feature", new Set(["application"])],
      ["application", new Set(["feature"])],
      ["kernel", new Set()],
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
        "../../kernel/navigation/types",
      ),
      `${root}/kernel/navigation/types`,
    );
  });
});
