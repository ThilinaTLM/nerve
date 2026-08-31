import assert from "node:assert/strict";
import test from "node:test";
import { contractsSourcePolicyViolations } from "./contracts-source-policy.mjs";

test("contracts source imports owning files directly", () => {
  assert.deepEqual(
    contractsSourcePolicyViolations(
      "packages/contracts/src/domains/tasks/operations.ts",
      'import { taskRecordSchema } from "./task.js";',
    ),
    [],
  );
});

test("contracts source rejects internal barrel imports", () => {
  assert.deepEqual(
    contractsSourcePolicyViolations(
      "packages/contracts/src/domains/tasks/operations.ts",
      'import { taskRecordSchema } from "./index.js";',
    ),
    ["contracts source must import the owning file, not ./index.js"],
  );
});

test("contracts test names describe behavior rather than implementation", () => {
  assert.deepEqual(
    contractsSourcePolicyViolations(
      "packages/contracts/test/task/task.schema.test.ts",
      "",
    ),
    ["contracts tests must use behavior-oriented names, not .schema.test.ts"],
  );
  assert.deepEqual(
    contractsSourcePolicyViolations(
      "packages/contracts/test/task/task-record-validation.test.ts",
      "",
    ),
    [],
  );
});
