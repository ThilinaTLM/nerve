import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  workerRequestSchema,
  workerStartExecutionSchema,
} from "../src/domains/execution-worker/index.js";

test("execution worker golden start request matches TypeScript contracts", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../fixtures/execution-worker/start-request.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const request = workerRequestSchema.parse(fixture);
  const start = workerStartExecutionSchema.parse(request.params);
  assert.equal(request.method, "execution.start");
  assert.equal(start.executionId, "tool_fixture");
  assert.equal(start.belowNormalPriority, true);
});
