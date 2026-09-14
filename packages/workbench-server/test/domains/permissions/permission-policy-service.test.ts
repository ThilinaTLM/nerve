import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import { PermissionPolicyService } from "../../../src/domains/permissions/permission-policy.service.js";
import { PermissionOverlayRepairService } from "../../../src/domains/permissions/permission-overlay-repair.service.js";
import { CanonicalPolicySaveCoordinator } from "../../../src/domains/permissions/canonical-policy-save-coordinator.js";
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
  assert.match(resolved.selectedRuleSetDigest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(resolved.sourceDocuments.length >= 1);
  const conversationSource = resolved.sourceDocuments.find(
    (source) => source.origin === "conversation",
  );
  assert.ok(conversationSource);
  assert.match(conversationSource.digest, /^sha256:[a-f0-9]{64}$/);
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
  assert.equal(resolved.executionBlocked, true);
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

test("INV-POLICY-04 records prepared bytes before a remembered file save", async () => {
  const { service, storage, agent } = await setup();
  const coordinator = new CanonicalPolicySaveCoordinator(
    storage.canonicalStore,
    service,
  );
  const saved = await coordinator.prepareAndSave({
    origin: "conversation",
    ownerId: agent.conversationId,
    ruleSetId: "supervised",
    rule: allowWrite,
    saveIntentId: "policy_save_coordinated",
    commandId: "remember-conversation-rule",
    scope: { kind: "conversation", ownerId: agent.conversationId },
    conversationId: agent.conversationId,
    runId: "run_policy",
    memberId: "member_policy",
    approvalCommandId: "approval-policy",
    now: "2026-09-14T00:00:00.000Z",
  });
  assert.equal(saved.state, "saved_pending_finalization");
  assert.equal(saved.fileOutcome, "saved");
  const persisted = await storage.canonicalStore.policy.readSaveIntent(
    saved.saveIntentId,
  );
  assert.deepEqual(persisted, saved);
  assert.ok(
    await storage.canonicalStore.execution.readArtifactManifest(
      saved.schemaVersion === 2 ? saved.intendedDocumentManifestId : "",
    ),
  );
  const restarted = new CanonicalPolicySaveCoordinator(
    storage.canonicalStore,
    service,
  );
  const [finalized] = await restarted.recoverPending({
    approvalStillApplicable: async () => true,
    finalizeApproval: async () => "committed",
    now: () => "2026-09-14T00:00:01.000Z",
  });
  assert.equal(finalized?.state, "finalized");
  assert.equal(
    (await storage.canonicalStore.policy.listPendingSaveIntents()).length,
    0,
  );
});

test("INV-POLICY-04 startup recovery fails closed when a prepared manifest is corrupt", async () => {
  const { service, storage, agent } = await setup();
  const identity = await storage.canonicalStore.readTimelineStateIdentity();
  const admission = await storage.canonicalStore.readTimelineRuntimeAdmission();
  assert.ok(identity);
  assert.ok(admission);
  const recorded = {
    schemaVersion: 2 as const,
    saveIntentId: "policy_save_missing_manifest",
    commandId: "missing-manifest",
    scope: { kind: "conversation" as const, ownerId: agent.conversationId },
    documentIdentity: "conversation:permissions.json",
    intendedDocumentDigest: `sha256:${"b".repeat(64)}`,
    ruleFingerprint: `sha256:${"c".repeat(64)}`,
    state: "recorded" as const,
    fileOutcome: "not_attempted" as const,
    approvalOutcome: "not_attempted" as const,
    conversationId: agent.conversationId,
    runId: "run_policy_missing",
    memberId: "member_policy_missing",
    approvalCommandId: "approval-policy-missing",
    intendedDocumentManifestId: "manifest_missing_policy",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
  };
  assert.equal(
    (
      await storage.canonicalStore.commitConversationCommand({
        namespaceId: identity.namespaceId,
        executionIncarnationId: admission.executionIncarnationId,
        operationKind: "seed_missing_policy_manifest",
        ownerKind: "policy_scope",
        ownerId: agent.conversationId,
        commandId: recorded.commandId,
        fingerprintVersion: 1,
        fingerprint: `sha256:${"d".repeat(64)}`,
        expectedHeads: [],
        transitions: [],
        artifactManifests: [
          {
            manifestId: recorded.intendedDocumentManifestId,
            schemaVersion: 1,
            data: { corrupted: true },
          },
        ],
        policySaveIntents: [recorded],
        outcome: recorded,
        publicationIntents: [],
        now: recorded.createdAt,
      })
    ).kind,
    "committed",
  );
  const [recovered] = await new CanonicalPolicySaveCoordinator(
    storage.canonicalStore,
    service,
  ).recoverPending({
    approvalStillApplicable: async () => true,
    finalizeApproval: async () => "committed",
    now: () => "2026-09-14T00:00:01.000Z",
  });
  assert.equal(recovered?.state, "conflicted");
  assert.equal(recovered?.fileOutcome, "external_conflict");
});

test("INV-POLICY-04 prepared remembered saves never overwrite external edits", async () => {
  const { service, storage } = await setup();
  const prepared = await service.prepareRuleSave(
    "user",
    "supervised",
    allowWrite,
  );
  await writeFile(
    storage.paths.permissionsConfigPath,
    '{"schemaVersion":2,"overlays":[]}\n',
  );
  const conflicted = await service.commitPreparedRuleSave(prepared);
  assert.equal(conflicted.kind, "external_conflict");

  const refreshed = await service.prepareRuleSave(
    "user",
    "supervised",
    allowWrite,
  );
  const saved = await service.commitPreparedRuleSave(refreshed);
  assert.equal(saved.kind, "saved");
  assert.equal(
    saved.kind === "saved" ? saved.digest : undefined,
    refreshed.intendedDocumentDigest,
  );
  const policy = await service.readOverlay("user", "supervised");
  assert.equal(
    policy.rules.some((rule) => rule.id === allowWrite.id),
    true,
  );
});

test("one invalid rule causes the complete overlay to be ignored", async () => {
  const { service, storage, agent, project } = await setup();
  const invalid = JSON.stringify({
    schemaVersion: 1,
    rules: [allowWrite, { ...allowWrite, id: "bad", priority: 1 }],
  });
  await writeFile(storage.paths.permissionsConfigPath, invalid);
  const resolved = await service.resolve(agent);
  assert.equal(
    resolved.policy.rules.some((entry) => entry.origin === "user"),
    false,
  );
  assert.ok(
    resolved.policy.ignoredOverlays.some((item) => item.origin === "user"),
  );
  assert.equal(resolved.executionBlocked, true);
  const repair = new PermissionOverlayRepairService({
    storage,
    getProject: () => project,
    trustProject: (projectId) => service.trustProject(projectId),
  });
  assert.equal(
    (
      await repair.reset({
        origin: "user",
        expectedDocumentDigest: `sha256:${"0".repeat(64)}`,
        quarantine: true,
      })
    ).kind,
    "external_conflict",
  );
  assert.equal(
    await readFile(storage.paths.permissionsConfigPath, "utf8"),
    invalid,
  );
  const reset = await repair.reset({
    origin: "user",
    expectedDocumentDigest: `sha256:${createHash("sha256").update(invalid).digest("hex")}`,
    quarantine: true,
  });
  assert.equal(reset.kind, "reset");
  assert.equal((await service.resolve(agent)).executionBlocked, false);
  assert.equal(
    (
      await readdir(
        join(storage.paths.home, "quarantine", "permission-overlays"),
      )
    ).length,
    1,
  );
});
