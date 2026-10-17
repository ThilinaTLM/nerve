import assert from "node:assert/strict";
import test from "node:test";
import { launchesOperationDefinitions } from "../../src/domains/launches/operations.js";

test("starting a saved definition requires explicit project ownership", () => {
  const operation = launchesOperationDefinitions.find(
    (item) => item.method === "launch.startDefinition",
  )!;
  assert.equal(
    operation.paramsSchema.safeParse({ definitionId: "launchdef_copied" })
      .success,
    false,
  );
  assert.equal(
    operation.paramsSchema.safeParse({
      projectId: "",
      definitionId: "launchdef_copied",
    }).success,
    false,
  );
  assert.equal(
    operation.paramsSchema.safeParse({
      projectId: "project_copy",
      definitionId: "launchdef_copied",
    }).success,
    false,
  );
  assert.deepEqual(
    operation.paramsSchema.parse({
      projectId: "proj_copy",
      definitionId: "launchdef_copied",
    }),
    { projectId: "proj_copy", definitionId: "launchdef_copied" },
  );
});
