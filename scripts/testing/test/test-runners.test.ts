import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkspace } from "../../workspace/graph.ts";
import { TEST_RUNNERS } from "../test-runners.ts";

const workspace = loadWorkspace();

test("every package with a test script has a runner entry that matches it exactly", () => {
  for (const [name, pkg] of workspace) {
    const script = pkg.scripts.test;
    if (script === undefined) continue;
    assert.equal(
      TEST_RUNNERS.get(name)?.script,
      script,
      `${name}: update TEST_RUNNERS in scripts/testing/test-runners.ts to match its test script`,
    );
  }
});

test("runner entries only describe existing packages", () => {
  for (const name of TEST_RUNNERS.keys())
    assert.ok(workspace.has(name), `${name} is not a workspace package`);
});
