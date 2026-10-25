import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { atomicReplaceFile } from "../../storage-bootstrap/file-mutations.js";
import { digestBytes } from "../scoped-store/scoped-document-store.js";
import { agentConfigurationOperations } from "./scoped-configuration-operations.js";
import { freezeChildPreferences } from "@nervekit/contracts/agent-configuration";
import {
  A,
  B,
  fixture,
  lead,
  leadDocument,
  mutation,
  project,
  put,
  user,
} from "./agent-configuration-test-fixture.js";

void test("read baselines exclude edited scope and requirements while retaining process and recommendations", async (t) => {
  const f = await fixture(t, {
    captureResources: () => ({
      options: { process: { model: B } },
      isCurrent: () => true,
    }),
  });
  await f.agent(lead, {
    ...leadDocument,
    appliedProfile: {
      name: "coding",
      source: "builtin",
      sourceDigest: "a".repeat(64),
      instructions: "",
      recommendations: { retry: { enabled: false } },
      requirements: { permissionRuleSetId: "locked" },
    },
    overrides: { model: A },
  });
  const operations = agentConfigurationOperations(f.service);
  const p = await operations.get(project);
  assert.equal(p.status, "available");
  if (p.status === "available") assert.deepEqual(p.inherited.model, A);
  const c = await operations.get(lead);
  assert.equal(c.status, "available");
  if (c.status === "available") {
    assert.deepEqual(c.inherited.model, B);
    assert.equal(c.inherited.retry?.enabled, false);
    assert.notEqual(c.inherited.permissionRuleSetId, "locked");
    assert.deepEqual(c.overrides, { model: A });
  }
  await f.service.saveCreation(
    user,
    mutation(0, "missing", {
      defaultAgentProfile: "planning",
      scopedModels: [A],
    }),
  );
  const creation = await operations.creation(project);
  assert.equal(creation.status, "available");
  if (creation.status === "available")
    assert.deepEqual(creation.inherited, {
      defaultAgentProfile: "planning",
      scopedModels: [A],
    });
  const userCreation = await operations.creation(user);
  if (userCreation.status === "available")
    assert.deepEqual(userCreation.inherited, {
      defaultAgentProfile: "coding",
      scopedModels: [],
    });
});

void test("saving cleans existing redundant values against lower layers, not process locks", async (t) => {
  const f = await fixture(t, {
    captureResources: () => ({
      options: { process: { model: B } },
      isCurrent: () => true,
    }),
  });
  await f.agent(user, {
    schemaVersion: 1,
    revision: 0,
    overrides: { model: B, tools: { web_search: { enabled: true } } },
  });
  const loaded = await f.service.ensureLoaded(user);
  if (loaded.status === "unavailable") throw new Error("user unavailable");
  const saved = await f.service.save(user, mutation(0, loaded.value.digest));
  assert.deepEqual(saved.value.document.overrides, { model: B });
  await f.agent(project, {
    schemaVersion: 1,
    revision: 0,
    overrides: { model: B, tools: { web_search: { enabled: true } } },
  });
  const p = await f.service.ensureLoaded(project);
  if (p.status === "unavailable") throw new Error("project unavailable");
  assert.deepEqual(p.value.document.overrides.model, B);
  const cleaned = await f.service.save(project, mutation(0, p.value.digest));
  assert.deepEqual(cleaned.value.document.overrides, {});
});

void test("conversation saves inherit recommendations and process but never profile requirements", async (t) => {
  const f = await fixture(t, {
    captureResources: () => ({
      options: { process: { model: B } },
      isCurrent: () => true,
    }),
  });
  await f.agent(lead, {
    ...leadDocument,
    appliedProfile: {
      name: "coding",
      source: "builtin",
      sourceDigest: "a".repeat(64),
      instructions: "",
      recommendations: { retry: { enabled: false } },
      requirements: { permissionRuleSetId: "locked" },
    },
    overrides: {
      model: B,
      retry: { enabled: false },
      permissionRuleSetId: "locked",
    },
  });
  const state = await f.service.ensureLoaded(lead);
  if (state.status === "unavailable")
    throw new Error("conversation unavailable");
  const saved = await f.service.save(lead, mutation(0, state.value.digest));
  assert.deepEqual(saved.value.document.overrides, {
    permissionRuleSetId: "locked",
  });
});

void test("lead creation and profile commits prune choices; child frozen defaults are unchanged", async (t) => {
  const f = await fixture(t);
  const created = await f.service.createConversation("new", {
    ...leadDocument,
    revision: 1,
    overrides: { model: A },
  });
  assert.deepEqual(created.value.document.overrides, {});
  const appliedProfile = {
    name: "coding",
    source: "builtin" as const,
    sourceDigest: "a".repeat(64),
    instructions: "",
    recommendations: { model: B },
    requirements: {},
  };
  const committed = await f.service.commitProfile(
    "new",
    { revision: created.value.revision, digest: created.value.digest },
    appliedProfile,
    { model: B },
    () => true,
  );
  assert.deepEqual(committed.document.overrides, {});
  const frozenDefaults = freezeChildPreferences({ user: { model: A } });
  const child = await f.service.createConversation("child-new", {
    ...leadDocument,
    revision: 1,
    frozenDefaults,
  });
  assert.ok("frozenDefaults" in child.value.document);
  assert.deepEqual(child.value.document.frozenDefaults, frozenDefaults);
});

void test("queued project creation save compares the user baseline when its transaction starts", async (t) => {
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let blockedPath: string | undefined;
  const f = await fixture(t, {
    io: {
      write: async (...args) => {
        if (args[0] === blockedPath) {
          blockedPath = undefined;
          started();
          await blocked;
        }
        return atomicReplaceFile(...args);
      },
    },
  });
  t.after(() => release());
  const u = await f.service.saveCreation(
    user,
    mutation(0, "missing", { scopedModels: [A] }),
  );
  await f.service.loadCreation(project);
  blockedPath = f.service.paths.creation(project);
  const first = f.service.saveCreation(project, mutation(0, "missing"));
  await entered;
  // The first empty save's exact next generation is known, so the queued CAS is valid.
  const firstDigest = digestBytes(
    `${JSON.stringify({ schemaVersion: 1, revision: 1, overrides: {} }, null, 2)}\n`,
  );
  const queued = f.service.saveCreation(
    project,
    mutation(1, firstDigest, { scopedModels: [B] }),
  );
  // Both scopes are loaded: drain queued save preparation before changing the user.
  await setImmediate();
  await f.service.saveCreation(
    user,
    mutation(u.value.revision, u.value.digest, { scopedModels: [B] }),
  );
  release();
  const initial = await first;
  assert.equal(initial.value.digest, firstDigest);
  const saved = await queued;
  assert.deepEqual(saved.value.document.overrides, {});
});

void test("creation saves clean redundant default profiles and atomic model lists", async (t) => {
  const f = await fixture(t);
  await f.service.loadCreation(user);
  const unrestricted = await f.service.saveCreation(
    user,
    mutation(0, "missing", { scopedModels: [] }),
  );
  assert.deepEqual(unrestricted.value.document.overrides, {});
  assert.deepEqual(await f.service.getInheritedCreationPreferences(user), {
    defaultAgentProfile: "coding",
    scopedModels: [],
  });
  const u = await f.service.saveCreation(
    user,
    mutation(unrestricted.value.revision, unrestricted.value.digest, {
      defaultAgentProfile: "coding",
      scopedModels: [A, B],
    }),
  );
  assert.deepEqual(u.value.document.overrides, { scopedModels: [A, B] });
  await put(f.service.paths.creation(project), {
    schemaVersion: 1,
    revision: 0,
    overrides: { defaultAgentProfile: "coding", scopedModels: [B, A] },
  });
  const existing = await f.service.loadCreation(project);
  if (existing.status === "unavailable")
    throw new Error("creation unavailable");
  assert.deepEqual(existing.value.document.overrides.scopedModels, [B, A]);
  const p = await f.service.saveCreation(
    project,
    mutation(0, existing.value.digest),
  );
  assert.deepEqual(p.value.document.overrides, {});
  const empty = await f.service.saveCreation(
    project,
    mutation(p.value.revision, p.value.digest, { scopedModels: [] }),
  );
  assert.deepEqual(empty.value.document.overrides, { scopedModels: [] });
});

void test("Jira equal profiles disappear and later user changes flow through project and conversation", async (t) => {
  const f = await fixture(t);
  await f.agent(user, {
    schemaVersion: 1,
    revision: 0,
    overrides: { model: A, tools: { jira: { enabled: true, profileId: "x" } } },
  });
  const equal = { tools: { jira: { enabled: true, profileId: "x" } } };
  const p = await f.service.save(project, mutation(0, "missing", equal));
  assert.deepEqual(p.value.document.overrides, {});
  const l = await f.service.ensureLoaded(lead);
  if (l.status === "unavailable") throw new Error("conversation unavailable");
  const c = await f.service.save(lead, mutation(0, l.value.digest, equal));
  assert.deepEqual(c.value.document.overrides, {});
  const u = await f.service.ensureLoaded(user);
  if (u.status === "unavailable") throw new Error("user unavailable");
  await f.service.save(
    user,
    mutation(0, u.value.digest, { tools: { jira: { profileId: "z" } } }),
  );
  const view = await f.service.getEffective("lead");
  assert.equal(view.status, "available");
  if (view.status === "available")
    assert.deepEqual(view.resolution.settings.tools?.jira, {
      enabled: true,
      profileId: "z",
    });
  const changed = await f.service.save(
    project,
    mutation(p.value.revision, p.value.digest, {
      tools: { jira: { enabled: true, profileId: "y" } },
    }),
  );
  assert.deepEqual(changed.value.document.overrides, {
    tools: { jira: { profileId: "y" } },
  });
});

void test("equal reasoning becomes inherited before validating a changed model's fit", async (t) => {
  const f = await fixture(t, {
    captureResources: () => ({
      options: {
        clampThinking: (model, level) =>
          model.modelId === "b" ? "low" : level,
      },
      isCurrent: () => true,
    }),
  });
  await f.agent(user, {
    schemaVersion: 1,
    revision: 0,
    overrides: { model: A, reasoningLevel: "high" },
  });
  const saved = await f.service.save(
    project,
    mutation(0, "missing", { model: B, reasoningLevel: "high" }),
  );
  assert.deepEqual(saved.value.document.overrides, { model: B });
  const effective = await f.service.getEffective("lead");
  assert.equal(effective.status, "available");
  if (effective.status === "available") {
    assert.equal(effective.resolution.settings.reasoningLevel, "low");
    assert.equal(
      effective.resolution.provenance["/reasoningLevel"].adjusted,
      true,
    );
  }
});
