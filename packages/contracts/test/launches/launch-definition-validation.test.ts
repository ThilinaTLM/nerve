import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLaunchDefinitionRequestSchema,
  launchDefinitionFileSchema,
  launchDefinitionSchema,
} from "../../src/domains/launch-definitions/index.js";

test("launch definitions default to a single active run", () => {
  const request = createLaunchDefinitionRequestSchema.parse({
    command: "pnpm dev",
  });
  assert.equal(request.runPolicy, "single");
  const definition = launchDefinitionSchema.parse({
    id: "launchdef_01",
    scope: { kind: "project", projectId: "proj_01" },
    command: request.command,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(definition.runPolicy, "single");
});

test("project launch definition files derive scope from their location", () => {
  const portable = launchDefinitionFileSchema.parse({
    version: 1,
    definitions: [
      {
        id: "launchdef_portable",
        scope: { kind: "project" },
        command: "pnpm check",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  assert.deepEqual(portable.definitions[0]?.scope, { kind: "project" });

  const projected = launchDefinitionFileSchema.parse({
    version: 1,
    definitions: [
      {
        ...portable.definitions[0],
        scope: { kind: "project", projectId: "proj_foreign" },
      },
    ],
  });
  assert.deepEqual(projected.definitions[0]?.scope, { kind: "project" });
});

test("launch definitions accept an optional guarded TCP port", () => {
  assert.equal(
    createLaunchDefinitionRequestSchema.parse({
      command: "pnpm dev",
      port: 3000,
    }).port,
    3000,
  );
  assert.throws(() =>
    createLaunchDefinitionRequestSchema.parse({ command: "pnpm dev", port: 0 }),
  );
  assert.throws(() =>
    createLaunchDefinitionRequestSchema.parse({
      command: "pnpm dev",
      port: 65_536,
    }),
  );
});

test("launch definitions support explicit concurrent runs", () => {
  assert.equal(
    createLaunchDefinitionRequestSchema.parse({
      command: "pnpm test",
      runPolicy: "concurrent",
    }).runPolicy,
    "concurrent",
  );
});
