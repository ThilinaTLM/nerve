import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAgentConfigurationResultSchema,
  getCreationPreferencesResultSchema,
} from "@nervekit/contracts/agent-configuration";
import { fixture, project, user } from "./agent-configuration-test-fixture.js";
import { agentConfigurationOperations } from "./scoped-configuration-operations.js";

void test("failed baseline capture with no stored health returns schema-valid scoped retry diagnostics", async (t) => {
  const f = await fixture(t, {
    captureResources: () => {
      throw new Error("resource snapshot changed");
    },
  });
  const result = await agentConfigurationOperations(f.service).get(user);
  assert.equal(result.status, "unavailable");
  assert.deepEqual(f.service.health(), []);
  assert.deepEqual(getAgentConfigurationResultSchema.parse(result), result);
  if (result.status !== "unavailable") return;
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].scope, "user");
  assert.equal(result.diagnostics[0].document, "agent");
  assert.equal(result.diagnostics[0].code, "dependencies-changing");
  assert.deepEqual(result.diagnostics[0].recoveryChoices, ["retry"]);
});

void test("baseline failures expose relevant dependency health, never unrelated project health", async (t) => {
  const f = await fixture(t);
  const other = { scope: "project", projectId: "other" } as const;
  await f.agent(other, "invalid JSON");
  await f.service.ensureLoaded(other);
  t.mock.method(f.service, "getInheritedSettings", async () => {
    throw new Error("dependencies changed");
  });
  const operations = agentConfigurationOperations(f.service);
  const fallback = await operations.get(project);
  assert.equal(fallback.status, "unavailable");
  if (fallback.status !== "unavailable") return;
  assert.deepEqual(
    fallback.diagnostics.map((issue) => [
      issue.scope,
      issue.scopeId,
      issue.code,
    ]),
    [["project", "p", "dependencies-changing"]],
  );
  await f.agent(user, "invalid JSON");
  await f.service.reload(user);
  const dependency = await operations.get(project);
  assert.equal(dependency.status, "unavailable");
  assert.deepEqual(
    getAgentConfigurationResultSchema.parse(dependency),
    dependency,
  );
  if (dependency.status === "unavailable")
    assert.ok(dependency.diagnostics.every((issue) => issue.scope === "user"));
});

void test("project documents report whether their exact bytes are trusted", async (t) => {
  const trustedDigests = new Set<string>();
  const f = await fixture(t, {
    projectAgentTrustState: (_id, _path, digest) =>
      trustedDigests.has(digest) ? "trusted" : "needs_review",
  });
  await f.agent(project, {
    schemaVersion: 1,
    revision: 1,
    overrides: { skills: { agentBrowser: { electron: true } } },
  });
  const operations = agentConfigurationOperations(f.service);
  const untrusted = await operations.get(project);
  assert.equal(untrusted.status, "available");
  if (untrusted.status !== "available") return;
  assert.equal(untrusted.trustState, "needs_review");
  trustedDigests.add(untrusted.source.digest);
  const trusted = await operations.get(project);
  assert.equal(trusted.status === "available" && trusted.trustState, "trusted");
  const userResult = await operations.get(user);
  assert.equal(
    userResult.status === "available" && userResult.trustState,
    undefined,
  );
});

void test("creation inherited-baseline failure returns schema-valid unavailable rather than rejecting", async (t) => {
  const f = await fixture(t);
  t.mock.method(f.service, "getInheritedCreationPreferences", async () => {
    throw new Error("creation dependencies changed");
  });
  const result = await agentConfigurationOperations(f.service).creation(
    project,
  );
  assert.equal(result.status, "unavailable");
  assert.deepEqual(f.service.health(), []);
  assert.deepEqual(getCreationPreferencesResultSchema.parse(result), result);
  if (result.status !== "unavailable") return;
  assert.equal(result.diagnostics[0].document, "conversation-defaults");
  assert.equal(result.diagnostics[0].scopeId, "p");
  assert.equal(result.diagnostics[0].code, "dependencies-changing");
  assert.deepEqual(result.diagnostics[0].recoveryChoices, ["retry"]);
});
