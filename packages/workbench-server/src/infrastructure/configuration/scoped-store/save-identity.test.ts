import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ScopedDocumentStore,
  ScopeConflictError,
} from "./scoped-document-store.js";

interface Document {
  schemaVersion: number;
  revision: number;
}

void test("revision and digest are independently required, including across store instances", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "save-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "agent.json");
  const make = () =>
    new ScopedDocumentStore<string, Document>({
      resolvePath: () => file,
      required: () => false,
      supportedVersion: 1,
      parse: (value) => value as Document,
      empty: () => ({ schemaVersion: 1, revision: 0 }),
      issues: () => [{ code: "invalid-value", pointer: "" }],
    });
  const first = make();
  const second = make();
  await second.ensureLoaded("user");
  const saved = await first.save(
    "user",
    { revision: 0, digest: "missing" },
    (doc) => doc,
  );
  await assert.rejects(
    first.save(
      "user",
      { revision: 0, digest: saved.value.digest },
      (doc) => doc,
    ),
    ScopeConflictError,
  );
  await assert.rejects(
    first.save("user", { revision: 1, digest: "missing" }, (doc) => doc),
    ScopeConflictError,
  );
  await assert.rejects(
    second.save("user", { revision: 0, digest: "missing" }, (doc) => doc),
    ScopeConflictError,
  );
  assert.equal(JSON.parse(await readFile(file, "utf8")).revision, 1);
});

void test("persisted scope blocks while directory durability is pending, before acknowledgement", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "publish-pending-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let release!: () => void;
  let reached!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const atSync = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const store = new ScopedDocumentStore<string, Document>({
    resolvePath: () => path.join(root, "agent.json"),
    required: () => false,
    supportedVersion: 1,
    parse: (value) => value as Document,
    empty: () => ({ schemaVersion: 1, revision: 0 }),
    issues: () => [{ code: "invalid-value", pointer: "" }],
    syncDirectory: async () => {
      reached();
      await pending;
      return "unsupported";
    },
  });
  await store.ensureLoaded("user");
  const isCurrent = store.captureGenerations(["user"]);
  const saving = store.save(
    "user",
    { revision: 0, digest: "missing" },
    (doc) => doc,
  );
  await atSync;
  assert.equal(store.peek("user")?.status, "unavailable");
  assert.equal(isCurrent(), false);
  release();
  await saving;
  assert.equal(store.peek("user")?.status, "ready");
});
