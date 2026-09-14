import type { AgentRecord } from "@nervekit/contracts/agents";
import type { PolicyFallbackDecision } from "@nervekit/contracts/permissions";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalTimelineIdentityService } from "../conversations/timeline/canonical-timeline-identity.service.js";
import { conversationCommandFingerprint } from "../conversations/timeline/command-fingerprint.js";
import type { PermissionPolicyService } from "./permission-policy.service.js";
import {
  fallbackConfirmationFingerprint,
  policyFailureFingerprint,
} from "./policy-fingerprints.js";

/** Commits an explicit, diagnostic-bound Baseline-without-overlays decision. */
export class CanonicalPolicyFallbackCoordinator {
  private readonly identity: CanonicalTimelineIdentityService;

  constructor(
    private readonly store: CanonicalStore,
    private readonly policy: PermissionPolicyService,
  ) {
    this.identity = new CanonicalTimelineIdentityService(store);
  }

  async resolveReset(input: {
    diagnosticId: string;
    scope: { kind: "user" | "project" | "conversation"; ownerId: string };
    commandId: string;
    now: string;
  }): Promise<void> {
    const diagnostic = await this.store.policy.readDiagnostic(
      input.diagnosticId,
    );
    if (!diagnostic) throw new Error("Policy diagnostic not found.");
    if (
      diagnostic.scope.kind !== input.scope.kind ||
      diagnostic.scope.ownerId !== input.scope.ownerId
    ) {
      throw new Error("Policy diagnostic does not belong to the reset scope.");
    }
    if (diagnostic.state === "reset") return;
    if (diagnostic.state !== "unresolved") {
      throw new Error("Policy diagnostic is already resolved.");
    }
    const identity = await this.identity.resolve();
    const fingerprint = conversationCommandFingerprint({
      operation: "resolve_reset_policy_diagnostic",
      diagnosticId: diagnostic.diagnosticId,
      failureFingerprint: diagnostic.failureFingerprint,
    });
    const outcome = await this.store.commitConversationCommand({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "resolve_reset_policy_diagnostic",
      ownerKind: "policy_scope",
      ownerId: input.scope.ownerId,
      commandId: input.commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [],
      transitions: [],
      policyDiagnostics: [
        { ...diagnostic, state: "reset", resolvedAt: input.now },
      ],
      outcome: { diagnosticId: diagnostic.diagnosticId, state: "reset" },
      publicationIntents: [],
      now: input.now,
    });
    if (outcome.kind !== "committed" && outcome.kind !== "receipt_replay") {
      throw new Error(
        `Policy diagnostic reset resolution rejected: ${outcome.kind}.`,
      );
    }
  }

  async selectBaseline(input: {
    agent: AgentRecord;
    diagnosticId: string;
    commandId: string;
    now: string;
  }): Promise<PolicyFallbackDecision> {
    const diagnostic = await this.store.policy.readDiagnostic(
      input.diagnosticId,
    );
    if (!diagnostic) throw new Error("Policy diagnostic not found.");
    if (
      diagnostic.scope.kind !== "conversation" ||
      diagnostic.scope.ownerId !== input.agent.conversationId
    ) {
      throw new Error(
        "Policy diagnostic does not belong to this conversation.",
      );
    }
    if (diagnostic.failureKind !== "invalid_rule_set") {
      throw new Error(
        "Baseline fallback is valid only for an invalid selected rule set.",
      );
    }
    const resolved = await this.policy.resolve(input.agent);
    if (!resolved.fallback) {
      throw new Error("The selected permission rule set is no longer invalid.");
    }
    const expectedFailureFingerprint = policyFailureFingerprint(resolved);
    if (diagnostic.failureFingerprint !== expectedFailureFingerprint) {
      throw new Error("Policy diagnostic is stale and must be re-observed.");
    }
    const active = (
      await this.store.policy.readActiveFallbacks(resolved.requestedRuleSetId)
    ).find(({ decision }) => decision.diagnosticId === diagnostic.diagnosticId);
    if (active) return active.decision;
    if (diagnostic.state !== "unresolved") {
      throw new Error("Policy diagnostic is already resolved.");
    }

    const decision: PolicyFallbackDecision = {
      schemaVersion: 1,
      decisionId: `policy_decision_${diagnostic.diagnosticId.slice("policy_diagnostic_".length)}`,
      diagnosticId: diagnostic.diagnosticId,
      requestedRuleSetId: resolved.requestedRuleSetId,
      effectiveRuleSetId: "baseline",
      overlaysEnabled: false,
      confirmationFingerprint: fallbackConfirmationFingerprint({
        diagnosticId: diagnostic.diagnosticId,
        failureFingerprint: diagnostic.failureFingerprint,
        requestedRuleSetId: resolved.requestedRuleSetId,
      }),
      state: "active",
      decidedAt: input.now,
    };
    const identity = await this.identity.resolve();
    const fingerprint = conversationCommandFingerprint({
      operation: "select_baseline_policy_fallback",
      conversationId: input.agent.conversationId,
      diagnosticId: diagnostic.diagnosticId,
      failureFingerprint: diagnostic.failureFingerprint,
      requestedRuleSetId: resolved.requestedRuleSetId,
    });
    const outcome = await this.store.commitConversationCommand({
      namespaceId: identity.namespaceId,
      executionIncarnationId: identity.executionIncarnationId,
      operationKind: "select_baseline_policy_fallback",
      ownerKind: "policy_scope",
      ownerId: input.agent.conversationId,
      commandId: input.commandId,
      fingerprintVersion: 1,
      fingerprint,
      expectedHeads: [],
      transitions: [],
      policyDiagnostics: [
        { ...diagnostic, state: "fallback_selected", resolvedAt: input.now },
      ],
      policyFallbackDecisions: [decision],
      outcome: decision,
      publicationIntents: [],
      now: input.now,
    });
    if (outcome.kind === "committed" || outcome.kind === "receipt_replay") {
      return outcome.value as PolicyFallbackDecision;
    }
    throw new Error(`Policy fallback rejected: ${outcome.kind}.`);
  }
}
