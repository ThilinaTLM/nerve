import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createTaskDefinitionRequestSchema,
  taskDefinitionSchema,
} from "../src/index.js";

test("task definitions default to a single active run", () => {
  const request = createTaskDefinitionRequestSchema.parse({
    command: "pnpm dev",
  });
  assert.equal(request.runPolicy, "single");
  const definition = taskDefinitionSchema.parse({
    id: "taskdef_01",
    scope: { kind: "project", projectId: "proj_01" },
    command: request.command,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(definition.runPolicy, "single");
});

test("task definitions accept an optional guarded TCP port", () => {
  assert.equal(
    createTaskDefinitionRequestSchema.parse({ command: "pnpm dev", port: 3000 })
      .port,
    3000,
  );
  assert.throws(() =>
    createTaskDefinitionRequestSchema.parse({ command: "pnpm dev", port: 0 }),
  );
  assert.throws(() =>
    createTaskDefinitionRequestSchema.parse({
      command: "pnpm dev",
      port: 65_536,
    }),
  );
});

test("task definitions support explicit concurrent runs", () => {
  assert.equal(
    createTaskDefinitionRequestSchema.parse({
      command: "pnpm test",
      runPolicy: "concurrent",
    }).runPolicy,
    "concurrent",
  );
});
