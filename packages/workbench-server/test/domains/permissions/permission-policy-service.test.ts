import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ProjectRecord } from "@nervekit/contracts/projects";
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
  await service.saveRule(
    "conversation",
    "supervised",
    allowWrite,
    agent.conversationId,
  );
  const resolved = await service.resolve(agent);
  const winner = resolved.policy.rules.find(
    (entry) =>
      entry.origin === "conversation" && entry.rule.id === "allow-write",
  );
  assert.ok(winner);
  assert.equal(winner.precedence.scopeRank, 4);
  assert.deepEqual(
    (
      await service.readOverlay(
        "conversation",
        "supervised",
        agent.conversationId,
      )
    ).rules,
    [{ ...allowWrite, priority: 0 }],
  );
});

test("overlay rules apply only to their bound selected rule set", async () => {
  const { service, agent } = await setup();
  await service.saveRule("user", "planning", allowWrite);

  const coding = await service.resolve(agent);
  assert.equal(
    coding.policy.rules.some(
      (entry) => entry.origin === "user" && entry.rule.id === "allow-write",
    ),
    false,
  );

  agent.mode = "planning";
  const planning = await service.resolve(agent);
  assert.equal(planning.selectedRuleSetId, "planning");
  assert.ok(
    planning.policy.rules.some(
      (entry) =>
        entry.origin === "user" &&
        entry.ruleSetId === "planning" &&
        entry.rule.id === "allow-write",
    ),
  );
});

test("legacy flat overlays normalize to explicit groups and write forward", async () => {
  const { service, storage } = await setup();
  await writeFile(
    storage.paths.permissionsConfigPath,
    JSON.stringify({ schemaVersion: 1, rules: [allowWrite] }),
  );

  const configuration = await service.configuration("proj_test");
  for (const id of ["planning", "supervised", "autonomous", "read_only"]) {
    assert.ok(
      configuration.userOverlays.overlays.some(
        (overlay) =>
          overlay.ruleSetId === id && overlay.rules[0]?.id === "allow-write",
      ),
    );
  }

  await service.replaceOverlay("user", {
    ruleSetId: "supervised",
    rules: [],
  });
  const written = JSON.parse(
    await readFile(storage.paths.permissionsConfigPath, "utf8"),
  );
  assert.equal(written.schemaVersion, 2);
  assert.equal(
    written.overlays.some(
      (overlay: { ruleSetId: string }) => overlay.ruleSetId === "supervised",
    ),
    false,
  );
  assert.ok(
    written.overlays.some(
      (overlay: { ruleSetId: string }) => overlay.ruleSetId === "planning",
    ),
  );
});

test("dormant overlays remain visible but never apply to another set", async () => {
  const { service, storage, agent } = await setup();
  await writeFile(
    storage.paths.permissionsConfigPath,
    JSON.stringify({
      schemaVersion: 2,
      overlays: [{ ruleSetId: "removed-set", rules: [allowWrite] }],
    }),
  );
  const configuration = await service.configuration(agent.projectId);
  const removed = configuration.ruleSets.find(
    (ruleSet) => ruleSet.id === "removed-set",
  );
  assert.equal(removed?.available, false);
  assert.equal(
    (await service.resolve(agent)).policy.rules.some(
      (entry) => entry.origin === "user",
    ),
    false,
  );
});

test("trusted legacy project overlays retain trust until explicit v2 write-forward", async () => {
  const { service, project } = await setup();
  const path = join(project.dir, ".nerve", "config", "permissions.json");
  await mkdir(join(project.dir, ".nerve", "config"), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, rules: [allowWrite] }),
  );
  assert.equal((await service.trustProject(project.id)).status, "trusted");
  assert.ok(
    (await service.configuration(project.id)).projectOverlays.overlays.some(
      (overlay) => overlay.ruleSetId === "planning",
    ),
  );

  await service.replaceOverlay(
    "project",
    { ruleSetId: "planning", rules: [allowWrite] },
    project.id,
  );
  assert.equal((await service.projectTrust(project.id)).status, "trusted");
  assert.equal(JSON.parse(await readFile(path, "utf8")).schemaVersion, 2);
});

test("project overlays remain inactive until their complete content digest is trusted", async () => {
  const { service, project, agent } = await setup();
  await service.replaceOverlay(
    "project",
    { ruleSetId: "supervised", rules: [allowWrite] },
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
  raw.overlays[0].rules[0].description = "Externally changed";
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

test("project trust persists across service reconstruction and revokes in isolation", async () => {
  const { storage, service, project } = await setup();
  await service.replaceOverlay(
    "project",
    { ruleSetId: "supervised", rules: [allowWrite] },
    project.id,
  );
  const reconstructed = new PermissionPolicyService(storage, () => project);
  assert.equal(
    (await reconstructed.projectTrust(project.id)).status,
    "trusted",
  );
  await reconstructed.revokeProjectTrust(project.id);
  assert.equal((await service.projectTrust(project.id)).status, "untrusted");
});

test("invalid canonical project trust never activates an overlay", async () => {
  const { storage, service, project } = await setup();
  await service.replaceOverlay(
    "project",
    { ruleSetId: "supervised", rules: [allowWrite] },
    project.id,
  );
  const current = await storage.canonicalStore.readDocument(
    "project-permission-trust",
    "global",
    project.id,
  );
  await storage.canonicalStore.writeDocument({
    namespace: "project-permission-trust",
    scopeId: "global",
    documentId: project.id,
    data: {
      version: 1,
      digest: "invalid",
      trustedAt: new Date().toISOString(),
    },
    expectedRevision: current?.revision,
  });
  assert.equal((await service.projectTrust(project.id)).status, "untrusted");
});

test("invalid custom selection falls back to Baseline without overlays", async () => {
  const { service, agent } = await setup();
  await service.saveRule("user", "supervised", {
    ...allowWrite,
    id: "never-write",
    enforcement: "guardrail",
    decision: "deny",
  });
  agent.permissionRuleSetId = "missing-set";
  const resolved = await service.resolve(agent);
  assert.equal(resolved.fallback, true);
  assert.deepEqual(resolved.policy.activeRuleSetIds, ["baseline"]);
  assert.equal(
    resolved.policy.rules.some((entry) => entry.origin === "user"),
    false,
  );
  assert.match(resolved.diagnostics.join("\n"), /missing, disabled, malformed/);
});

test("Explore children receive only fixed Read only without overlays", async () => {
  const { service, agent } = await setup();
  await service.saveRule("user", "autonomous", allowWrite);
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
