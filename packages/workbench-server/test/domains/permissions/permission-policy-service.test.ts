import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { AgentRecord, ProjectRecord } from "@nervekit/contracts";
import { PermissionPolicyService } from "../../../src/domains/permissions/permission-policy.service.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

const roots: string[] = [];
const stores: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "nerve-rule-policy-"));
  roots.push(root);
  const storage = await initializeStorage(root);
  stores.push(storage.canonicalStore);
  const now = new Date().toISOString();
  const project: ProjectRecord = {
    id: "proj_test",
    name: "Test",
    dir: join(root, "workspace"),
    createdAt: now,
    updatedAt: now,
  };
  const service = new PermissionPolicyService(storage, (id) => {
    if (id !== project.id) throw new Error("Project not found.");
    return project;
  });
  const agent: AgentRecord = {
    id: "agent_test",
    conversationId: "conv_test",
    projectId: project.id,
    projectDir: project.dir,
    rootAgentId: "agent_test",
    mode: "coding",
    permissionLevel: "supervised",
    permissionRuleSetId: "supervised",
    workspaceScope: { roots: [project.dir] },
    budget: { depth: 0, maxDepth: 3 },
    thinkingLevel: "off",
    status: "idle",
    createdAt: now,
    updatedAt: now,
  };
  return { root, storage, project, service, agent };
}

const allowWrite = {
  id: "allow-write",
  enabled: true,
  priority: 1,
  enforcement: "overridable" as const,
  when: { toolNames: ["write"] },
  decision: "allow" as const,
};

test("conversation rules persist independently and compose at highest scope", async () => {
  const { service, agent } = await setup();
  await service.saveRule("conversation", allowWrite, agent.conversationId);
  const resolved = await service.resolve(agent);
  const winner = resolved.policy.rules.find(
    (entry) =>
      entry.origin === "conversation" && entry.rule.id === "allow-write",
  );
  assert.ok(winner);
  assert.equal(winner.precedence.scopeRank, 4);
  assert.deepEqual(
    (await service.readOverlay("conversation", agent.conversationId)).rules,
    [{ ...allowWrite, priority: 0 }],
  );
});

test("project overlays remain inactive until their complete content digest is trusted", async () => {
  const { service, project, agent } = await setup();
  await service.replaceOverlay(
    "project",
    { schemaVersion: 1, rules: [allowWrite] },
    project.id,
  );
  assert.equal((await service.projectTrust(project.id)).status, "trusted");
  assert.ok(
    (await service.resolve(agent)).policy.rules.some(
      (entry) => entry.origin === "project" && entry.rule.id === "allow-write",
    ),
  );

  const path = join(project.dir, ".nerve", "config", "permissions.json");
  const raw = JSON.parse(await readFile(path, "utf8"));
  raw.rules[0].description = "Externally changed";
  await writeFile(path, JSON.stringify(raw));
  assert.equal((await service.projectTrust(project.id)).status, "untrusted");
  const resolved = await service.resolve(agent);
  assert.equal(
    resolved.policy.rules.some((entry) => entry.origin === "project"),
    false,
  );
  assert.ok(
    resolved.policy.ignoredOverlays.some((item) => item.origin === "project"),
  );
});

test("invalid custom selection falls back to Baseline while retaining overlays", async () => {
  const { service, agent } = await setup();
  await service.saveRule("user", {
    ...allowWrite,
    id: "never-write",
    enforcement: "guardrail",
    decision: "deny",
  });
  agent.permissionRuleSetId = "missing-set";
  const resolved = await service.resolve(agent);
  assert.equal(resolved.fallback, true);
  assert.deepEqual(resolved.policy.activeRuleSetIds, ["baseline"]);
  assert.ok(
    resolved.policy.rules.some(
      (entry) => entry.origin === "user" && entry.rule.id === "never-write",
    ),
  );
  assert.match(resolved.diagnostics.join("\n"), /missing, disabled, malformed/);
});

test("Explore children receive only fixed Read only without overlays", async () => {
  const { service, agent } = await setup();
  await service.saveRule("user", allowWrite);
  agent.parentAgentId = "agent_parent";
  agent.permissionRuleSetId = "autonomous";
  const resolved = await service.resolve(agent);
  assert.deepEqual(resolved.policy.activeRuleSetIds, ["read_only"]);
  assert.equal(resolved.policy.subagent, true);
  assert.equal(
    resolved.policy.rules.some((entry) => entry.origin === "user"),
    false,
  );
});

test("one invalid rule causes the complete overlay to be ignored", async () => {
  const { service, storage, agent } = await setup();
  await writeFile(
    storage.paths.permissionsConfigPath,
    JSON.stringify({
      schemaVersion: 1,
      rules: [allowWrite, { ...allowWrite, id: "bad", priority: 1 }],
    }),
  );
  const resolved = await service.resolve(agent);
  assert.equal(
    resolved.policy.rules.some((entry) => entry.origin === "user"),
    false,
  );
  assert.ok(
    resolved.policy.ignoredOverlays.some((item) => item.origin === "user"),
  );
});
