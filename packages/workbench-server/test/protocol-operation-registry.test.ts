import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allOperationDefinitions } from "@nervekit/contracts";
import type { OrchestratorState } from "../src/app/orchestrator-state.js";
import { workbenchOperationHandlers } from "../src/protocol/http-dispatcher.js";
import { WORKBENCH_OPERATION_METHODS } from "../src/protocol/method-handlers.js";

describe("workbench operation registry", () => {
  it("registers every workbench-target operation and no manager-only methods", () => {
    const handlers = workbenchOperationHandlers({} as OrchestratorState);
    const expected = allOperationDefinitions()
      .filter((definition) =>
        definition.allowedTargetRoles.includes("workbench_server"),
      )
      .map((definition) => definition.method)
      .sort();
    assert.deepEqual([...WORKBENCH_OPERATION_METHODS].sort(), expected);
    for (const method of expected)
      assert.equal(typeof handlers[method], "function", method);
    for (const definition of allOperationDefinitions()) {
      if (definition.allowedTargetRoles.includes("workbench_server")) continue;
      assert.equal(handlers[definition.method], undefined, definition.method);
    }
  });
});
