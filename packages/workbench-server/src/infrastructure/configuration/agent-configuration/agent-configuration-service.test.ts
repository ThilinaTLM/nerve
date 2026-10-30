import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  freezeChildPreferences,
  configurationDiagnosticSchema,
} from "@nervekit/contracts/agent-configuration";
import { atomicReplaceFile } from "../../storage-bootstrap/file-mutations.js";
import { ScopeConflictError } from "../scoped-store/scoped-document-store.js";
import { AgentConfigurationService } from "./agent-configuration-service.js";

import {
  A,
  B,
  user,
  project,
  lead,
  definition,
  leadDocument,
  put,
  fixture,
  mutation,
} from "./agent-configuration-test-fixture.js";

void test("initialization validates user documents, not project/conversation documents or ownership", async (t) => {
  const f = await fixture(t);
  await put(
    path.join(
      f.options.home,
      "data",
      "conversations",
      "broken",
      "config",
      "agent.json",
    ),
    "{",
  );
  assert.equal(f.ownerReads(), 0);
  assert.deepEqual((await f.service.initialize()).diagnostics, []);
  assert.equal(f.ownerReads(), 0);
  assert.equal(
    f.service.paths.agent(user),
    path.join(f.options.home, "config", "agent.json"),
  );
  assert.equal(
    f.service.paths.agent(project),
    path.join(
      f.options.projectDirectory("p")!,
      ".nerve",
      "config",
      "agent.json",
    ),
  );
  assert.equal(
    f.service.paths.profile(user, "coding"),
    path.join(f.options.home, "data", "agent-profiles", "coding.json"),
  );
  assert.equal(
    f.service.paths.profile(project, "coding"),
    path.join(
      f.options.projectDirectory("p")!,
      ".nerve",
      "agent-profiles",
      "coding.json",
    ),
  );
  await assert.rejects(readFile(f.service.paths.creation(user)), {
    code: "ENOENT",
  });
});

void test("effective resolution publishes immutable provenance and invalidates only loaded lead dependencies", async (t) => {
  const f = await fixture(t);
  await f.agent(
    { scope: "conversation", conversationId: "child" },
    {
      ...leadDocument,
      frozenDefaults: freezeChildPreferences({ user: { model: A } }),
    },
  );
  const first = await f.service.getEffective("lead");
  const child = await f.service.getEffective("child");
  assert.equal(first.status, "available");
  if (first.status === "available") {
    assert.deepEqual(first.resolution.settings.model, A);
    assert.equal(first.resolution.provenance["/model"].source, "user");
    assert.ok(Object.isFrozen(first.resolution.settings));
  }
  const loaded = await f.service.ensureLoaded(user);
  if (loaded.status === "unavailable") throw new Error("Expected valid user");
  await f.service.save(user, mutation(0, loaded.value.digest, { model: B }));
  const next = await f.service.getEffective("lead");
  assert.notEqual(next, first);
  if (next.status === "available")
    assert.deepEqual(next.resolution.settings.model, B);
  assert.equal(await f.service.getEffective("child"), child);
  const saved = await f.service.save(
    project,
    mutation(0, "missing", { model: A }),
  );
  const projected = await f.service.getEffective("lead");
  if (projected.status === "available")
    assert.equal(projected.resolution.provenance["/model"].source, "project");
  assert.equal(saved.value.path, f.service.paths.agent(project));
});

void test("concurrent UI saves and exact-byte external edits cannot overwrite divergent files", async (t) => {
  const f = await fixture(t);
  const state = await f.service.ensureLoaded(user);
  if (state.status === "unavailable") throw new Error("Expected valid user");
  const results = await Promise.allSettled([
    f.service.save(user, mutation(0, state.value.digest, { model: B })),
    f.service.save(user, mutation(0, state.value.digest, { model: A })),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const success = results.find((result) => result.status === "fulfilled");
  if (!success || success.status !== "fulfilled")
    throw new Error("Expected one save");
  const value = success.value.value;
  const bytes = JSON.stringify(value.document);
  await put(value.path, bytes);
  await assert.rejects(
    f.service.save(
      user,
      mutation(value.revision, value.digest, { reasoningLevel: "low" }),
    ),
    ScopeConflictError,
  );
  assert.equal(await readFile(value.path, "utf8"), bytes);
});

void test("failed persistence preserves the complete published view; failed publication blocks until reload", async (t) => {
  let failWrite = false;
  let failPublish = false;
  let publications = 0;
  const f = await fixture(t, {
    io: {
      write: async (...args) => {
        if (failWrite) throw new Error("disk full");
        await atomicReplaceFile(...args);
      },
    },
    publish: (domain) => {
      if (domain === "agent") {
        if (failPublish) throw new Error("publication failed");
        publications += 1;
      }
    },
  });
  const before = await f.service.getEffective("lead");
  const state = await f.service.ensureLoaded(user);
  if (state.status === "unavailable") throw new Error("Expected valid user");
  const count = publications;
  failWrite = true;
  await assert.rejects(
    f.service.save(user, mutation(0, state.value.digest, { model: B })),
    /disk full/,
  );
  assert.equal(publications, count);
  assert.equal(await f.service.getEffective("lead"), before);
  failWrite = false;
  failPublish = true;
  await assert.rejects(
    f.service.save(user, mutation(0, state.value.digest, { model: B })),
    /publication failed/,
  );
  assert.equal((await f.service.getEffective("lead")).status, "unavailable");
  failPublish = false;
  assert.equal((await f.service.ensureLoaded(user)).status, "unavailable");
  await f.service.reload(user);
  const next = await f.service.getEffective("lead");
  assert.equal(next.status, "available");
  if (next.status === "available")
    assert.deepEqual(next.resolution.settings.model, B);
});

void test("health is strict, scoped, redacted and isolated; missing required conversation does not invent defaults", async (t) => {
  const f = await fixture(t);
  const cases = [
    { input: "{", code: "malformed-json", pointer: "" },
    {
      input: {
        schemaVersion: 1,
        revision: 0,
        overrides: { typo: "do not include this secret" },
      },
      code: "unknown-field",
      pointer: "/overrides/typo",
    },
    {
      input: { schemaVersion: 2, revision: 0, overrides: {} },
      code: "future-version",
      pointer: "/schemaVersion",
    },
    {
      input: { schemaVersion: 1.5, revision: 0, overrides: {} },
      code: "invalid-value",
      pointer: "/schemaVersion",
    },
  ];
  for (const entry of cases) {
    await f.agent(project, entry.input);
    await f.service.reload(project);
    const health = f.service
      .health()
      .find((issue) => issue.scope === "project");
    assert.equal(health?.code, entry.code);
    assert.equal(health?.pointer, entry.pointer);
    assert.equal(health?.scopeId, "p");
    configurationDiagnosticSchema.parse(health);
    assert.equal(
      JSON.stringify(health).includes("do not include this secret"),
      false,
    );
    const effective = await f.service.getEffective("lead");
    assert.equal(effective.status, "available");
    assert.ok(effective.diagnostics.some((issue) => issue.scope === "project"));
  }
  const missing = await f.service.getEffective("other");
  assert.equal(missing.status, "unavailable");
  assert.ok(
    missing.diagnostics.some(
      (issue) => issue.code === "missing-required" && issue.scopeId === "other",
    ),
  );
  await assert.rejects(
    readFile(
      f.service.paths.agent({ scope: "conversation", conversationId: "other" }),
    ),
    { code: "ENOENT" },
  );
});

void test("conversation ownership selects strict child schema; snapshots work without mutable catalog", async (t) => {
  const f = await fixture(t);
  await f.agent(
    { scope: "conversation", conversationId: "child-invalid" },
    leadDocument,
  );
  assert.equal(
    (await f.service.getEffective("child-invalid")).status,
    "unavailable",
  );
  const profile = {
    name: "deleted",
    source: "user",
    sourceDigest: "a".repeat(64),
    instructions: "Snapshot",
    recommendations: { model: B },
    requirements: {},
  };
  await f.agent(lead, { ...leadDocument, appliedProfile: profile });
  const view = await f.service.getEffective("lead");
  assert.equal(view.status, "available");
  if (view.status === "available") {
    assert.deepEqual(view.resolution.settings.model, B);
    assert.equal(view.resolution.provenance["/model"].source, "recommendation");
  }
  await assert.rejects(
    f.service.save(
      { scope: "conversation", conversationId: "child-invalid" },
      mutation(0, "missing", { model: A }),
    ),
    /Child preference editing/,
  );
});

void test("UI mutations preserve choices beneath requirements, omit legacy receipts, reject metadata, and reset by deletion", async (t) => {
  const f = await fixture(t);
  const receipt = { id: "transition", kind: "plan-approval" };
  await f.agent(lead, {
    ...leadDocument,
    lastTransition: receipt,
    appliedProfile: {
      name: "coding",
      source: "builtin",
      sourceDigest: "a".repeat(64),
      instructions: "",
      recommendations: {},
      requirements: { model: A },
    },
  });
  const state = await f.service.ensureLoaded(lead);
  if (state.status === "unavailable")
    throw new Error("Expected valid conversation");
  await assert.rejects(
    f.service.save(lead, mutation(0, state.value.digest, { revision: 900 })),
  );
  const saved = await f.service.save(
    lead,
    mutation(0, state.value.digest, {
      model: B,
      tools: { web_fetch: { enabled: false } },
    }),
  );
  assert.deepEqual(
    (saved.value.document as typeof leadDocument & { lastTransition: unknown })
      .lastTransition,
    undefined,
  );
  assert.deepEqual(saved.value.document.overrides.model, B);
  const effective = await f.service.getEffective("lead");
  assert.equal(effective.status, "available");
  if (effective.status === "available")
    assert.deepEqual(effective.resolution.settings.model, A);
  const reset = await f.service.save(
    lead,
    mutation(1, saved.value.digest, {}, [
      "/overrides/tools/web_fetch",
      "/overrides/model",
    ]),
  );
  assert.deepEqual(reset.value.document.overrides, {});
});

void test("creation preferences layer atomically, reject unknown fields, reset and keep exact paths", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.service.getCreationPreferences("p")).status,
    "available",
  );
  const saved = await f.service.saveCreation(
    user,
    mutation(0, "missing", {
      defaultAgentProfile: "explore",
      scopedModels: [A],
    }),
  );
  await f.service.saveCreation(
    project,
    mutation(0, "missing", { scopedModels: [B] }),
  );
  const effective = await f.service.getCreationPreferences("p");
  assert.equal(effective.status, "available");
  if (effective.status === "available")
    assert.deepEqual(effective.overrides, {
      defaultAgentProfile: "explore",
      scopedModels: [B],
    });
  await f.service.saveCreation(
    user,
    mutation(1, saved.value.digest, {}, ["/overrides/defaultAgentProfile"]),
  );
  const reset = await f.service.getCreationPreferences("p");
  if (reset.status === "available")
    assert.equal(reset.overrides.defaultAgentProfile, "coding");
  await assert.rejects(
    f.service.saveCreation(user, mutation(2, "missing", { unsupported: true })),
  );
});

void test("cache corruption/loss is harmless; lists never resolve unknown conversation documents", async (t) => {
  const f = await fixture(t);
  await put(f.service.paths.summaries, "{");
  await f.service.initialize();
  const reads = f.ownerReads();
  assert.equal(f.service.getSummary("unopened"), undefined);
  assert.equal(f.ownerReads(), reads);
  await f.service.getEffective("lead");
  assert.deepEqual(f.service.getSummary("lead")?.model, A);
  assert.equal(await f.service.flushSummaries(), true);
  await rm(f.service.paths.summaries);
  const restarted = new AgentConfigurationService(f.options);
  await restarted.initialize();
  assert.equal(restarted.getSummary("lead"), undefined);
  assert.equal((await restarted.getEffective("lead")).status, "available");
  restarted.forgetConversation("lead");
  assert.equal(restarted.getSummary("lead"), undefined);
  await restarted.flushSummaries();
});

void test("resource-generation changes invalidate captures without IO polling", async (t) => {
  let version = 0;
  const f = await fixture(t, {
    captureResources: () => {
      const captured = version;
      return {
        options: { referenceAvailable: () => version === 0 },
        isCurrent: () => captured === version,
      };
    },
  });
  const first = await f.service.getEffective("lead");
  const capture = await f.service.captureEffective("lead");
  assert.equal(capture.isCurrent(), true);
  version = 1;
  assert.equal(capture.isCurrent(), false);
  const next = await f.service.getEffective("lead");
  assert.notEqual(first, next);
  assert.ok(
    next.diagnostics.some((issue) => issue.code === "missing-reference"),
  );
});

void test("explicit host creation validates trusted role and cannot replace an existing document", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.service.createConversation("child-new", { ...leadDocument, revision: 1 }),
  );
  const created = await f.service.createConversation("child-new", {
    ...leadDocument,
    revision: 1,
    frozenDefaults: freezeChildPreferences({ user: { model: B } }),
  });
  assert.equal(created.value.revision, 1);
  const child = await f.service.getEffective("child-new");
  assert.equal(child.status, "available");
  if (child.status === "available")
    assert.deepEqual(child.resolution.settings.model, B);
  await assert.rejects(
    f.service.createConversation("child-new", created.value.document),
    ScopeConflictError,
  );
  const reloaded = await f.service.getEffective("child-new");
  assert.equal(reloaded.status, "available");
  if (reloaded.status === "available" && child.status === "available")
    assert.deepEqual(reloaded.resolution, child.resolution);
  await f.service.profiles.save(user, "coding", "missing", definition);
  assert.equal(await f.service.getEffective("child-new"), reloaded);
});

void test("legacy receipts are inert on read and disappear on ordinary saves", async (t) => {
  const f = await fixture(t);
  const receipt = { id: "accepted-plan", kind: "plan-approval" };
  await f.agent(lead, { ...leadDocument, lastTransition: receipt });
  const state = await f.service.ensureLoaded(lead);
  if (state.status === "unavailable")
    throw new Error("Expected valid conversation");
  assert.equal(
    JSON.parse(await readFile(state.value.path, "utf8")).lastTransition.id,
    receipt.id,
  );
  await f.service.getEffective("lead");
  assert.equal(
    JSON.parse(await readFile(state.value.path, "utf8")).lastTransition.id,
    receipt.id,
  );
  const saved = await f.service.save(
    lead,
    mutation(0, state.value.digest, { model: B }),
  );
  assert.deepEqual(
    JSON.parse(await readFile(saved.value.path, "utf8")).lastTransition,
    undefined,
  );
});

void test("deleted conversation identities cannot fail later preference saves or resurrect summaries", async (t) => {
  let deleted = false;
  const f = await fixture(t, {
    conversationOwner: () => {
      if (deleted) throw new Error("Conversation deleted");
      return { projectId: "p", role: "lead" };
    },
  });
  const capture = await f.service.captureEffective("lead");
  f.service.forgetConversation("lead");
  deleted = true;
  assert.equal(capture.isCurrent(), false);
  const state = await f.service.ensureLoaded(user);
  if (state.status === "unavailable") throw new Error("Expected preferences");
  const saved = await f.service.save(
    user,
    mutation(0, state.value.digest, { model: B }),
  );
  assert.equal(saved.value.revision, 1);
  await f.service.flushSummaries();
  assert.equal(f.service.getSummary("lead"), undefined);
  await assert.rejects(
    f.service.createConversation("lead", { ...leadDocument, revision: 1 }),
    /cannot be reused/,
  );
});

void test("cache write failure cannot fail an acknowledged configuration save", async (t) => {
  const f = await fixture(t);
  await mkdir(f.service.paths.summaries, { recursive: true });
  await f.service.initialize();
  const state = await f.service.ensureLoaded(user);
  if (state.status === "unavailable")
    throw new Error("Expected valid preferences");
  const saved = await f.service.save(
    user,
    mutation(0, state.value.digest, { model: B }),
  );
  assert.equal(saved.value.revision, 1);
  const view = await f.service.getEffective("lead");
  assert.equal(view.status, "available");
  assert.equal(await f.service.flushSummaries(), false);
});

void test("startup reports invalid user files but not ordinary subagent-only catalog applicability", async (t) => {
  const f = await fixture(t, {
    builtins: {
      explore: JSON.stringify({
        ...definition,
        name: "explore",
        usableBy: "subagent",
      }),
    },
  });
  await f.agent(user, {
    schemaVersion: 1,
    revision: 0,
    overrides: { unexpected: true },
  });
  const result = await f.service.initialize();
  assert.equal(f.ownerReads(), 0);
  assert.deepEqual(
    result.diagnostics.map((issue) => issue.code),
    ["unknown-field"],
  );
});

void test("same-layer pairs block saves, while cross-layer reasoning fits without rewriting the choice", async (t) => {
  const f = await fixture(t, {
    captureResources: () => ({
      options: { clampThinking: () => "low", referenceAvailable: () => true },
      isCurrent: () => true,
    }),
  });
  const state = await f.service.ensureLoaded(lead);
  if (state.status === "unavailable")
    throw new Error("Expected valid conversation");
  await assert.rejects(
    f.service.save(
      lead,
      mutation(0, state.value.digest, { model: B, reasoningLevel: "high" }),
    ),
    /Unsupported explicit/,
  );
  assert.equal(
    JSON.parse(await readFile(state.value.path, "utf8")).revision,
    0,
  );
  const saved = await f.service.save(
    lead,
    mutation(0, state.value.digest, { reasoningLevel: "high" }),
  );
  assert.equal(saved.value.document.overrides.reasoningLevel, "high");
  const view = await f.service.getEffective("lead");
  assert.equal(view.status, "available");
  if (view.status !== "available") throw new Error("Expected fitted view");
  assert.equal(view.resolution.settings.reasoningLevel, "low");
  assert.deepEqual(view.resolution.provenance["/reasoningLevel"], {
    source: "conversation",
    adjusted: true,
  });
  assert.deepEqual(view.resolution.diagnostics, [
    { code: "reasoning-adjusted", pointer: "/reasoningLevel" },
  ]);
});

void test("creation checks launch generations again at durable publication", async (t) => {
  const { service } = await fixture(t);
  let checks = 0;
  await assert.rejects(
    service.createConversation(
      "new-lead",
      {
        schemaVersion: 1,
        revision: 1,
        overrides: {},
        appliedProfile: null,
      },
      () => ++checks === 1,
    ),
  );
  assert.equal(checks, 2);
  assert.equal((await service.getEffective("new-lead")).status, "unavailable");
});

void test("D10 context edits are conversation-local, clearable and survive profile replacement", async (t) => {
  const f = await fixture(t);
  assert.equal(f.service.getConversationContext("lead"), undefined);
  await f.agent(lead, {
    ...leadDocument,
    lastTransition: { id: "old", kind: "plan-approval" },
  });
  await f.service.configureContext("lead", {
    instructions: "Local instructions",
    systemPrompt: "Custom base",
  });
  assert.deepEqual(f.service.getConversationContext("lead"), {
    instructions: "Local instructions",
    systemPrompt: "Custom base",
  });
  const state = await f.service.ensureLoaded(lead);
  assert.notEqual(state.status, "unavailable");
  if (state.status === "unavailable") throw new Error("fixture unavailable");
  assert.equal(
    JSON.parse(await readFile(state.value.path, "utf8")).lastTransition,
    undefined,
  );
  await f.service.commitProfile(
    "lead",
    state.value,
    {
      name: "coding",
      source: "builtin",
      sourceDigest: "0".repeat(64),
      instructions: "Separate profile instructions",
      recommendations: {},
      requirements: {},
    },
    {},
    () => true,
  );
  assert.deepEqual(f.service.getConversationContext("lead"), {
    instructions: "Local instructions",
    systemPrompt: "Custom base",
  });
  await assert.rejects(f.service.configureContext("lead", { model: A }));
  await f.service.configureContext("lead", {
    instructions: null,
    systemPrompt: null,
  });
  assert.deepEqual(f.service.getConversationContext("lead"), {
    instructions: null,
    systemPrompt: null,
  });
  const bytes = await readFile(f.service.paths.agent(lead), "utf8");
  assert(!Object.hasOwn(JSON.parse(bytes), "context"));
});
void test("D10 history context has no project readiness dependency and invalid JSON stays unknown", async (t) => {
  const f = await fixture(t, {
    prepareProject: async () => {
      throw new Error("Unrelated project unavailable");
    },
  });
  await f.agent(lead, {
    ...leadDocument,
    context: { instructions: "Readable history" },
  });
  assert.deepEqual(await f.service.loadConversationContext("lead"), {
    instructions: "Readable history",
    systemPrompt: null,
  });
  await f.agent({ scope: "conversation", conversationId: "broken" }, "{");
  assert.equal(await f.service.loadConversationContext("broken"), undefined);
  await assert.rejects(
    f.service.configureContext("broken", {
      instructions: "Do not repair implicitly",
    }),
  );
});
