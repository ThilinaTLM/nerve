import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { atomicReplaceFile } from "../../storage-bootstrap/file-mutations.js";
import {
  digestBytes,
  ScopeConflictError,
  ScopedDocumentStore,
  ScopeUnavailableError,
  type DocumentIssue,
  type ScopedDocumentOptions,
} from "./scoped-document-store.js";

interface Doc {
  schemaVersion: number;
  revision: number;
  overrides: { enabled?: boolean };
}
interface Scope {
  kind: "user" | "project" | "conversation";
  id: string;
}
const user: Scope = { kind: "user", id: "user" };
const conversation: Scope = { kind: "conversation", id: "one" };

function parse(input: unknown): Doc {
  const doc = input as Doc;
  if (
    Object.keys(doc).some(
      (key) => !["schemaVersion", "revision", "overrides"].includes(key),
    )
  )
    throw new Error("unknown-field");
  if (
    doc.schemaVersion !== 1 ||
    !Number.isSafeInteger(doc.revision) ||
    doc.revision < 0 ||
    !doc.overrides ||
    (doc.overrides.enabled !== undefined &&
      typeof doc.overrides.enabled !== "boolean")
  )
    throw new Error("invalid-value");
  return structuredClone(doc);
}

async function fixture(
  t: { after(fn: () => Promise<void>): void },
  overrides: Partial<ScopedDocumentOptions<Scope, Doc>> = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "scoped-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let resolutions = 0;
  const options: ScopedDocumentOptions<Scope, Doc> = {
    resolvePath: (scope) => {
      resolutions += 1;
      return path.join(root, `${scope.id}.json`);
    },
    required: (scope) => scope.kind === "conversation",
    supportedVersion: 1,
    parse,
    empty: () => ({ schemaVersion: 1, revision: 0, overrides: {} }),
    issues: (error) => [
      { code: (error as Error).message as DocumentIssue["code"], pointer: "" },
    ],
    ...overrides,
  };
  const store = new ScopedDocumentStore(options);
  return {
    root,
    store,
    options,
    resolutions: () => resolutions,
    file: (scope: Scope) => path.join(root, `${scope.id}.json`),
  };
}
const enabled = (doc: Readonly<Doc>): Doc => ({
  ...doc,
  overrides: { enabled: true },
});

void test("startup is lazy, absent optional inherits without writing; absent required blocks", async (t) => {
  const f = await fixture(t);
  assert.equal(f.resolutions(), 0);
  const loaded = await f.store.ensureLoaded(user);
  assert.equal(loaded.status, "missing-optional");
  assert.equal(loaded.value.digest, "missing");
  assert.equal(loaded.value.revision, 0);
  await assert.rejects(readFile(f.file(user)), { code: "ENOENT" });
  const required = await f.store.ensureLoaded(conversation);
  assert.equal(required.status, "unavailable");
  if (required.status === "unavailable")
    assert.equal(required.issues[0]?.code, "missing-required");
});

void test("whole atomic save persists before publication and acknowledges immutable revision one", async (t) => {
  const events: string[] = [];
  const f = await fixture(t, {
    publish: (value) => {
      events.push(`publish:${value.revision}`);
      assert.ok(Object.isFrozen(value.document.overrides));
    },
    write: async (...args) => {
      await atomicReplaceFile(...args);
      events.push("persist");
    },
  });
  await f.store.ensureLoaded(user);
  const saved = await f.store.save(
    user,
    { revision: 0, digest: "missing" },
    enabled,
  );
  assert.deepEqual(events, ["publish:0", "persist", "publish:1"]);
  const bytes = await readFile(f.file(user));
  assert.equal(saved.value.digest, digestBytes(bytes));
  assert.deepEqual(JSON.parse(bytes.toString()), {
    schemaVersion: 1,
    revision: 1,
    overrides: { enabled: true },
  });
  assert.ok(["synchronized", "unsupported"].includes(saved.durability));
});

void test("concurrent stale saves serialize the complete mutation and only one commits", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    f.store.save(user, { revision: 0, digest: "missing" }, enabled),
    f.store.save(user, { revision: 0, digest: "missing" }, enabled),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const failure = results.find((result) => result.status === "rejected");
  assert.ok(
    failure?.status === "rejected" &&
      failure.reason instanceof ScopeConflictError,
  );
  assert.equal(JSON.parse(await readFile(f.file(user), "utf8")).revision, 1);
});

void test("exact bytes detect external edits even when revision and parsed values are unchanged", async (t) => {
  const f = await fixture(t);
  const first = await f.store.save(
    user,
    { revision: 0, digest: "missing" },
    enabled,
  );
  const external = JSON.stringify(first.value.document);
  await writeFile(f.file(user), external);
  // Routine use is memory-only, not polling external edits.
  assert.equal((await f.store.ensureLoaded(user)).status, "ready");
  await assert.rejects(
    f.store.save(user, { revision: 1, digest: first.value.digest }, enabled),
    ScopeConflictError,
  );
  assert.equal(await readFile(f.file(user), "utf8"), external);
  await rm(f.file(user));
  await assert.rejects(
    f.store.save(user, { revision: 1, digest: first.value.digest }, enabled),
    ScopeConflictError,
  );
});

void test("persistence failure and invalid candidate preserve the old generation and release serialization", async (t) => {
  let fail = true;
  const f = await fixture(t, {
    write: async (...args) => {
      if (fail) throw new Error("disk full");
      await atomicReplaceFile(...args);
    },
  });
  const before = await f.store.ensureLoaded(user);
  await assert.rejects(
    f.store.save(user, { revision: 0, digest: "missing" }, enabled),
    /disk full/,
  );
  assert.equal(f.store.peek(user), before);
  fail = false;
  await assert.rejects(
    f.store.save(user, { revision: 0, digest: "missing" }, () => ({
      schemaVersion: 1,
      extra: true,
      overrides: {},
    })),
    /unknown-field/,
  );
  assert.equal(f.store.peek(user), before);
  await f.store.save(user, { revision: 0, digest: "missing" }, enabled);
});

void test("publication failure blocks even retained memory until authoritative reload", async (t) => {
  let fail = false;
  const f = await fixture(t, {
    retainOnInvalid: true,
    publish: () => {
      if (fail) throw new Error("subscriber failed");
    },
  });
  await f.store.ensureLoaded(user);
  fail = true;
  await assert.rejects(
    f.store.save(user, { revision: 0, digest: "missing" }, enabled),
    /subscriber failed/,
  );
  const state = f.store.peek(user);
  assert.equal(state?.status, "unavailable");
  if (state?.status === "unavailable") assert.equal(state.retained, undefined);
  assert.equal(JSON.parse(await readFile(f.file(user), "utf8")).revision, 1);
  await assert.rejects(
    f.store.save(user, { revision: 1, digest: "missing" }, enabled),
    ScopeUnavailableError,
  );
  fail = false;
  assert.equal((await f.store.ensureLoaded(user)).status, "unavailable");
  const reloaded = await f.store.reload(user);
  assert.equal(reloaded.status, "ready");
  assert.equal(reloaded.value.revision, 1);
});

void test("directory sync failure after rename blocks until reload; unsupported durability is explicit", async (t) => {
  const f = await fixture(t, {
    syncDirectory: async () => {
      throw new Error("fsync failed");
    },
  });
  await assert.rejects(
    f.store.save(user, { revision: 0, digest: "missing" }, enabled),
    /fsync failed/,
  );
  assert.equal(f.store.peek(user)?.status, "unavailable");
  assert.equal((await f.store.reload(user)).status, "ready");
  const g = await fixture(t, { syncDirectory: async () => "unsupported" });
  assert.equal(
    (await g.store.save(user, { revision: 0, digest: "missing" }, enabled))
      .durability,
    "unsupported",
  );
});

void test("health distinguishes malformed/unknown/future/invalid/IO, preserves bytes, caches failure", async (t) => {
  const f = await fixture(t);
  for (const [content, code] of [
    ["{", "malformed-json"],
    [
      '{"schemaVersion":1,"revision":0,"overrides":{},"typo":1}',
      "unknown-field",
    ],
    ['{"schemaVersion":9,"revision":0,"overrides":{}}', "future-version"],
    [
      '{"schemaVersion":1,"revision":0,"overrides":{"enabled":3}}',
      "invalid-value",
    ],
  ]) {
    await writeFile(f.file(user), content);
    const result = await f.store.reload(user);
    assert.equal(result.status, "unavailable");
    if (result.status === "unavailable")
      assert.equal(result.issues[0]?.code, code);
    assert.equal(await readFile(f.file(user), "utf8"), content);
  }
  const io = await fixture(t, { resolvePath: () => f.root });
  const result = await io.store.ensureLoaded(user);
  assert.equal(result.status, "unavailable");
  if (result.status === "unavailable")
    assert.equal(result.issues[0]?.code, "io-error");
  await writeFile(
    f.file(user),
    JSON.stringify({ schemaVersion: 1, revision: 0, overrides: {} }),
  );
  assert.equal((await f.store.ensureLoaded(user)).status, "unavailable");
  assert.equal((await f.store.reload(user)).status, "ready");
});

void test("invalid reload exposes retained non-security memory only by explicit opt-in", async (t) => {
  const f = await fixture(t, { retainOnInvalid: true });
  const first = await f.store.ensureLoaded(user);
  await writeFile(f.file(user), "{");
  const next = await f.store.reload(user);
  assert.equal(next.status, "unavailable");
  if (next.status === "unavailable" && first.status !== "unavailable")
    assert.equal(next.retained, first.value);
});

void test("dependent hooks and generation vectors invalidate async work, without opening conversations", async (t) => {
  const f = await fixture(t);
  await f.store.ensureLoaded(user);
  const stillCurrent = f.store.captureGenerations([user]);
  let invalidations = 0;
  const dispose = f.store.onInvalidate(user, () => {
    invalidations += 1;
  });
  assert.equal(stillCurrent(), true);
  await f.store.save(user, { revision: 0, digest: "missing" }, enabled);
  assert.equal(stillCurrent(), false);
  assert.ok(invalidations > 0);
  assert.equal(f.store.peek(conversation), undefined);
  dispose();
  const count = invalidations;
  await f.store.reload(user);
  assert.equal(invalidations, count);
});

void test("a failing dependent does not skip others and makes publication unavailable", async (t) => {
  const f = await fixture(t);
  await f.store.ensureLoaded(user);
  f.store.onInvalidate(user, () => {
    throw new Error("bad dependent");
  });
  let called = false;
  f.store.onInvalidate(user, () => {
    called = true;
  });
  await assert.rejects(
    f.store.save(user, { revision: 0, digest: "missing" }, enabled),
    /invalidation failed/,
  );
  assert.equal(called, true);
  assert.equal(f.store.peek(user)?.status, "unavailable");
});

await test("an unavailable prerequisite revokes generations and saves, reports its real source, and clears only on reload", async (t) => {
  const f = await fixture(t);
  await f.store.ensureLoaded(user);
  const current = f.store.captureGenerations([user]);
  const source = {
    path: path.join(f.root, "legacy.json"),
    digest: "legacy-digest",
    issues: [
      {
        code: "legacy-conversion-required" as const,
        pointer: "",
        message: "Unsupported legacy version",
      },
    ],
  };
  const blocked = await f.store.block(user, source);
  assert.equal(blocked.status, "unavailable");
  assert.equal(current(), false);
  assert.deepEqual(await f.store.ensureLoaded(user), blocked);
  assert.deepEqual(await f.store.block(user, source), blocked);
  await assert.rejects(
    f.store.save(user, { revision: 0, digest: "missing" }, (doc) => doc),
    ScopeUnavailableError,
  );
  if (blocked.status === "unavailable") {
    assert.equal(blocked.path, source.path);
    assert.equal(blocked.sourceDigest, source.digest);
  }
  assert.equal((await f.store.reload(user)).status, "missing-optional");
});
