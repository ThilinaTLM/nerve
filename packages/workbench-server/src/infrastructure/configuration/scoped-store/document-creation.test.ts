import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { profileDefinitionSchema } from "@nervekit/contracts/agent-configuration";
import {
  ScopedDocumentStore,
  ScopeConflictError,
  type RevisionedDocument,
} from "./scoped-document-store.js";

void test("digest-only definitions never acquire revision metadata and protect exact bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "digest-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "profile.json");
  const store = new ScopedDocumentStore({
    resolvePath: () => file,
    revisioned: false,
    required: () => true,
    supportedVersion: 1,
    parse: (input) => profileDefinitionSchema.parse(input),
    empty: () => {
      throw new Error("No defaults");
    },
    issues: () => [{ code: "invalid-value", pointer: "" }],
  });
  const definition = {
    schemaVersion: 1,
    name: "coding",
    description: "Coding",
    usableBy: "lead",
    instructions: "",
  };
  assert.equal((await store.ensureLoaded("profile")).status, "unavailable");
  const first = await store.create("profile", definition);
  assert.equal(
    Object.hasOwn(JSON.parse(await readFile(file, "utf8")), "revision"),
    false,
  );
  const second = await store.save(
    "profile",
    { revision: 0, digest: first.value.digest },
    (doc) => ({ ...doc, description: "Updated" }),
  );
  assert.equal(Object.hasOwn(second.value.document, "revision"), false);
  await writeFile(file, JSON.stringify(second.value.document));
  await assert.rejects(
    store.save(
      "profile",
      { revision: 0, digest: second.value.digest },
      (doc) => doc,
    ),
    ScopeConflictError,
  );
});

void test("explicit required-document creation is revision one and never overwrites an existing target", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "required-create-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "agent.json");
  const store = new ScopedDocumentStore<string, RevisionedDocument>({
    resolvePath: () => file,
    required: () => true,
    supportedVersion: 1,
    parse: (input) => input as RevisionedDocument,
    empty: () => ({ schemaVersion: 1, revision: 0 }),
    issues: () => [{ code: "invalid-value", pointer: "" }],
  });
  await assert.rejects(
    store.create("conversation", { schemaVersion: 1, revision: 0 }),
    /revision one/,
  );
  const first = await store.create("conversation", {
    schemaVersion: 1,
    revision: 1,
  });
  await assert.rejects(
    store.create("conversation", { schemaVersion: 1, revision: 1 }),
    ScopeConflictError,
  );
  assert.equal(first.value.revision, 1);
});
