import assert from "node:assert/strict";
import { removeTree } from "@nervekit/test-kit";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AgentConfigurationPaths } from "./document-adapters.js";
import { AgentProfileCatalog } from "./profile-catalog.js";
import { ScopeConflictError } from "../scoped-store/scoped-document-store.js";
const user = { scope: "user" } as const;
const project = { scope: "project", projectId: "p" } as const;
const profile = {
  schemaVersion: 1,
  name: "coding",
  whenToUse: "Coding",
  usableBy: "both",
  instructions: "Builtin",
};
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "profile-catalog-"));
  t.after(() => removeTree(root));
  const paths = new AgentConfigurationPaths({
    home: path.join(root, "home"),
    projectDirectory: () => path.join(root, "project"),
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
  });
  let trustedDigest: string | undefined;
  const catalog = new AgentProfileCatalog({
    paths,
    builtins: { coding: JSON.stringify(profile) },
    trustState: (id, _file, digest) =>
      id === null || digest === trustedDigest ? "trusted" : "needs_review",
  });
  return {
    paths,
    catalog,
    trust: (digest: string) => {
      trustedDigest = digest;
    },
  };
}

void test("catalog shadows complete definitions, isolates invalid entries and binds project trust to exact bytes", async (t) => {
  const f = await fixture(t);
  const builtin = await f.catalog.get("coding", "p");
  assert.equal(builtin.status, "available");
  const saved = await f.catalog.save(user, "coding", "missing", {
    ...profile,
    instructions: "User",
    enabled: false,
    recommendations: { reasoningLevel: "low" },
  });
  assert.equal(
    Object.hasOwn(
      JSON.parse(await readFile(f.paths.profile(user, "coding"), "utf8")),
      "revision",
    ),
    false,
  );
  const local = await f.catalog.get("coding", "p");
  assert.equal(local.status, "available");
  assert.equal(
    (await f.catalog.get("coding", "p", "child")).status,
    "available",
  );
  if (local.status === "available") {
    assert.equal(local.definition.enabled, false);
    assert.equal(local.source, "user");
    assert.equal(local.digest, saved.digest);
  }
  const projectSave = await f.catalog.save(project, "coding", "missing", {
    ...profile,
    instructions: "Project",
  });
  const untrusted = await f.catalog.get("coding", "p");
  assert.equal(untrusted.status, "unavailable");
  assert.equal(untrusted.diagnostics[0]?.code, "needs-review");
  f.trust(projectSave.digest);
  const trusted = await f.catalog.get("coding", "p");
  if (trusted.status === "available") {
    assert.equal(trusted.source, "project");
    assert.equal(trusted.definition.recommendations, undefined);
  } else assert.fail("Expected trusted project definition");
  await f.catalog.save(project, "coding", projectSave.digest, {
    ...profile,
    instructions: "Changed bytes",
  });
  assert.equal((await f.catalog.get("coding", "p")).status, "unavailable");
});

void test("malformed project shadow never falls back; unrelated catalog entries remain usable", async (t) => {
  const f = await fixture(t);
  const file = f.paths.profile(project, "coding");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "{");
  const lookup = await f.catalog.get("coding", "p");
  assert.equal(lookup.status, "unavailable");
  assert.equal(lookup.diagnostics[0]?.code, "malformed-json");
  await f.catalog.save(user, "explore", "missing", {
    ...profile,
    name: "explore",
    usableBy: "subagent",
    enabled: false,
  });
  assert.equal(
    (await f.catalog.get("explore", "p", "child")).status,
    "available",
  );
  assert.equal(
    (await f.catalog.get("explore", "p", "lead")).diagnostics[0]?.code,
    "inapplicable-profile",
  );
  const list = await f.catalog.list("p", "child");
  assert.equal(list.profiles.explore.status, "available");
  assert.equal(list.profiles.coding.status, "unavailable");
  assert.ok(
    f.catalog.health().some((issue) => issue.code === "malformed-json"),
  );
});

void test("profile UI saves detect conflicts/external edits, validate filename identity and version", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.catalog.save(user, "coding", "missing", { ...profile, revision: 0 }),
  );
  await assert.rejects(
    f.catalog.save(user, "coding", "missing", { ...profile, name: "explore" }),
  );
  const first = await f.catalog.save(user, "coding", "missing", profile);
  const changed = JSON.stringify(profile);
  await writeFile(f.paths.profile(user, "coding"), changed);
  await assert.rejects(
    f.catalog.save(user, "coding", first.digest, {
      ...profile,
      enabled: false,
    }),
    ScopeConflictError,
  );
  assert.equal(
    await readFile(f.paths.profile(user, "coding"), "utf8"),
    changed,
  );
  await writeFile(
    f.paths.profile(user, "coding"),
    JSON.stringify({ ...profile, schemaVersion: 2 }),
  );
  await f.catalog.reload(user, "coding");
  assert.equal(
    (await f.catalog.get("coding")).diagnostics[0]?.code,
    "future-version",
  );
  await assert.rejects(f.catalog.get("../escape"));
});

void test("editing reports which lower layer a local copy shadows", async (t) => {
  const f = await fixture(t);
  const shadows = async (scope: typeof user | typeof project, name: string) =>
    (await f.catalog.readForEditing(scope, name)).profile.shadows;
  assert.equal(await shadows(user, "coding"), undefined);
  await f.catalog.save(user, "coding", "missing", profile);
  assert.equal(await shadows(user, "coding"), "builtin");
  await f.catalog.save(project, "coding", "missing", profile);
  assert.equal(await shadows(project, "coding"), "user");
  const own = { ...profile, name: "own" };
  await f.catalog.save(project, "own", "missing", own);
  assert.equal(await shadows(project, "own"), undefined);
});

void test("a user profile is available only while its exact bytes are trusted, and Nerve's own writes keep it trusted", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "profile-catalog-user-"));
  t.after(() => removeTree(root));
  const paths = new AgentConfigurationPaths({
    home: path.join(root, "home"),
    projectDirectory: () => path.join(root, "project"),
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
  });
  const trusted = new Set<string>();
  const captured: string[] = [];
  const revoked: string[] = [];
  const catalog = new AgentProfileCatalog({
    paths,
    builtins: { coding: JSON.stringify(profile) },
    trustState: (_id, _file, digest) =>
      trusted.has(digest) ? "trusted" : "needs_review",
    userTrust: {
      capture: async (kind, file) => {
        captured.push(`${kind}:${file}`);
        return async (_file, output) => {
          trusted.add(
            `${(await import("node:crypto")).createHash("sha256").update(output).digest("hex")}`,
          );
        };
      },
      revoke: (_kind, file) => void revoked.push(file),
    },
  });
  // A file written by someone else waits.
  const file = paths.profile(user, "reviewer");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ ...profile, name: "reviewer", instructions: "Review." }),
  );
  const waiting = await catalog.get("reviewer");
  assert.equal(waiting.status, "unavailable");
  if (waiting.status === "unavailable")
    assert.equal(waiting.diagnostics[0].code, "needs-review");
  // A profile saved through Nerve is trusted from the start and after each edit.
  const saved = await catalog.save(user, "writer", "missing", {
    ...profile,
    name: "writer",
  });
  assert.equal((await catalog.get("writer")).status, "available");
  await catalog.save(user, "writer", saved.digest, {
    ...profile,
    name: "writer",
    instructions: "Edited",
  });
  assert.equal((await catalog.get("writer")).status, "available");
  assert.equal(captured.length, 2);
  const current = await catalog.readForEditing(user, "writer");
  await catalog.deleteLocal(user, "writer", current.localDigest);
  assert.deepEqual(revoked, [paths.profile(user, "writer")]);
});
