import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { PolicyDiagnostic } from "@nervekit/contracts/permissions";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import { CanonicalPolicyFallbackCoordinator } from "../../../src/domains/permissions/canonical-policy-fallback-coordinator.js";
import { PermissionPolicyService } from "../../../src/domains/permissions/permission-policy.service.js";
import {
  fallbackConfirmationFingerprint,
  policyFailureFingerprint,
} from "../../../src/domains/permissions/policy-fingerprints.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

const now = "2026-09-15T00:00:00.000Z";

test("INV-POLICY-03 requires a durable explicit Baseline-without-overlays decision", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-policy-fallback-"));
  const storage = await initializeStorage(home);
  try {
    const project: ProjectRecord = {
      id: "proj_fallback",
      name: "Fallback",
      dir: join(home, "workspace"),
      createdAt: now,
      updatedAt: now,
    };
    const agent: AgentRecord = {
      id: "agent_fallback",
      conversationId: "conv_fallback",
      projectId: project.id,
      projectDir: project.dir,
      rootAgentId: "agent_fallback",
      mode: "coding",
      permissionLevel: "supervised",
      permissionRuleSetId: "removed-custom-set",
      workspaceScope: { roots: [project.dir] },
      budget: { depth: 0, maxDepth: 3 },
      thinkingLevel: "off",
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    const policy = new PermissionPolicyService(storage, () => project);
    const blocked = await policy.resolve(agent);
    assert.equal(blocked.fallback, true);
    assert.equal(blocked.executionBlocked, true);
    assert.equal(blocked.selectedRuleSetId, "baseline");
    assert.equal(
      blocked.policy.rules.some((rule) =>
        ["user", "project", "conversation"].includes(rule.origin),
      ),
      false,
    );

    const identity = await storage.canonicalStore.readTimelineStateIdentity();
    const admission =
      await storage.canonicalStore.readTimelineRuntimeAdmission();
    assert.ok(identity);
    assert.ok(admission);
    const diagnostic: PolicyDiagnostic = {
      schemaVersion: 1,
      diagnosticId: "policy_diagnostic_fallback",
      scope: { kind: "conversation", ownerId: agent.conversationId },
      documentIdentity: "rule-set:removed-custom-set",
      failureFingerprint: policyFailureFingerprint(blocked),
      failureKind: "invalid_rule_set",
      affectedMemberIds: ["member_fallback"],
      state: "unresolved",
      observedAt: now,
    };
    const seeded = await storage.canonicalStore.commitConversationCommand({
      namespaceId: identity.namespaceId,
      executionIncarnationId: admission.executionIncarnationId,
      operationKind: "seed_policy_diagnostic",
      ownerKind: "policy_scope",
      ownerId: agent.conversationId,
      commandId: "seed-policy-diagnostic",
      fingerprintVersion: 1,
      fingerprint: `sha256:${"a".repeat(64)}`,
      expectedHeads: [],
      transitions: [],
      policyDiagnostics: [diagnostic],
      outcome: { ok: true },
      publicationIntents: [],
      now,
    });
    assert.equal(seeded.kind, "committed");

    const coordinator = new CanonicalPolicyFallbackCoordinator(
      storage.canonicalStore,
      policy,
    );
    const decision = await coordinator.selectBaseline({
      agent,
      diagnosticId: diagnostic.diagnosticId,
      commandId: "confirm-baseline-fallback",
      now: "2026-09-15T00:00:01.000Z",
    });
    assert.equal(decision.effectiveRuleSetId, "baseline");
    assert.equal(decision.overlaysEnabled, false);
    assert.equal(
      (
        await storage.canonicalStore.policy.readDiagnostic(
          diagnostic.diagnosticId,
        )
      )?.state,
      "fallback_selected",
    );

    const active =
      await storage.canonicalStore.policy.readActiveFallbacks(
        "removed-custom-set",
      );
    assert.equal(active.length, 1);
    assert.deepEqual(active[0]?.diagnostic.scope, {
      kind: "conversation",
      ownerId: agent.conversationId,
    });
    const admitted = await policy.resolve(agent);
    assert.equal(
      active[0]?.diagnostic.failureFingerprint,
      policyFailureFingerprint(admitted),
    );
    assert.equal(
      active[0]?.decision.confirmationFingerprint,
      fallbackConfirmationFingerprint({
        diagnosticId: diagnostic.diagnosticId,
        failureFingerprint: diagnostic.failureFingerprint,
        requestedRuleSetId: "removed-custom-set",
      }),
    );
    assert.equal(admitted.fallback, true);
    assert.equal(
      admitted.requestedRuleSetId,
      active[0]?.decision.requestedRuleSetId,
    );
    assert.equal(admitted.fallbackDecisionId, decision.decisionId);
    assert.equal(admitted.executionBlocked, false);
    assert.equal(
      admitted.policy.rules.some((rule) =>
        ["user", "project", "conversation"].includes(rule.origin),
      ),
      false,
    );
    assert.equal(
      (
        await coordinator.selectBaseline({
          agent,
          diagnosticId: diagnostic.diagnosticId,
          commandId: "confirm-baseline-fallback",
          now: "2026-09-15T00:00:01.000Z",
        })
      ).decisionId,
      decision.decisionId,
    );
  } finally {
    await storage.canonicalStore.close();
    await rm(home, { recursive: true, force: true });
  }
});
