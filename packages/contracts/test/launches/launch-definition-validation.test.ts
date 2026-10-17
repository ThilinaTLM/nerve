import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLaunchDefinitionRequestSchema,
  launchDefinitionFileSchema,
  launchDefinitionV1FileSchema,
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
    parentFolderId: null,
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  assert.equal(definition.runPolicy, "single");
});

test("project launch definition files derive scope from their location", () => {
  const portable = launchDefinitionFileSchema.parse({
    version: 2,
    folders: [],
    definitions: [
      {
        id: "launchdef_portable",
        scope: { kind: "project" },
        command: "pnpm check",
        parentFolderId: null,
        order: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  assert.deepEqual(portable.definitions[0]?.scope, { kind: "project" });

  const foreign = {
    ...portable.definitions[0],
    scope: { kind: "project", projectId: "proj_foreign" },
  };
  assert.throws(() =>
    launchDefinitionFileSchema.parse({ ...portable, definitions: [foreign] }),
  );
  const projected = launchDefinitionV1FileSchema.parse({
    version: 1,
    definitions: [
      {
        id: foreign.id,
        scope: foreign.scope,
        command: foreign.command,
        createdAt: foreign.createdAt,
        updatedAt: foreign.updatedAt,
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

test("v2 validates mixed sibling order, references, folder names and ancestry", () => {
  const folder = {
    id: "launchfolder_a",
    label: "A",
    parentFolderId: null,
    order: 0,
  };
  const valid = { version: 2, folders: [folder], definitions: [] };
  assert.doesNotThrow(() => launchDefinitionFileSchema.parse(valid));
  for (const folders of [
    [{ ...folder, order: 1 }],
    [{ ...folder, label: " A " }],
    [{ ...folder, parentFolderId: "launchfolder_missing" }],
    [{ ...folder, parentFolderId: folder.id }],
    [folder, { ...folder, id: "launchfolder_b", label: "a", order: 1 }],
    [folder, { ...folder, order: 1 }],
  ])
    assert.throws(() =>
      launchDefinitionFileSchema.parse({ ...valid, folders }),
    );
  assert.throws(() =>
    createLaunchDefinitionRequestSchema.parse({ command: "  " }),
  );
  assert.equal(
    createLaunchDefinitionRequestSchema.parse({ command: " echo test " })
      .command,
    " echo test ",
  );
});
