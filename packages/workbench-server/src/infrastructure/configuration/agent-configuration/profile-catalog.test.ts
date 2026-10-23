import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  description: "Coding",
  usableBy: "both",
  instructions: "Builtin",
};
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "profile-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = new AgentConfigurationPaths({
    home: path.join(root, "home"),
    projectDirectory: () => path.join(root, "project"),
    conversationOwner: () => ({ projectId: "p", role: "lead" }),
  });
  let trustedDigest: string | undefined;
  const catalog = new AgentProfileCatalog({
    paths,
    builtins: { coding: JSON.stringify(profile) },
    isTrusted: (_id, _file, digest) => digest === trustedDigest,
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
  if (local.status === "available") {
    assert.equal(local.source, "user");
    assert.equal(local.digest, saved.digest);
  }
  const projectSave = await f.catalog.save(project, "coding", "missing", {
    ...profile,
    instructions: "Project",
  });
  const untrusted = await f.catalog.get("coding", "p");
  assert.equal(untrusted.status, "unavailable");
  assert.equal(untrusted.diagnostics[0]?.code, "untrusted");
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
