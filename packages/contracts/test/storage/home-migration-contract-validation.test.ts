import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NERVE_HOME_MANIFEST,
  nerveHomeManifestSchema,
  nerveHomeManifestV1Schema,
  nerveHomeManifestV2Schema,
} from "../../src/domains/settings/index.js";
import {
  homeMigrationApprovalSchema,
  homeMigrationPlanSchema,
  homeMigrationProgressSchema,
  homeMigrationResultSchema,
} from "../../src/domains/storage/index.js";

const fingerprint = "a".repeat(64);
const quarantine = {
  entries: [
    {
      id: "quarantine-1",
      sourceStep: "sweep:conversation",
      unit: "conversation" as const,
      recordClass: "user-content" as const,
      source: "domain_documents",
      sourceKey: "conversation-1",
      conversationId: "conversation-1",
      reason: "Could not decode the conversation.",
      affectedRecords: 3,
      affectedBytes: 256,
      requiresApproval: true,
    },
  ],
  total: 1,
  derived: 0,
  userContent: 1,
  affectedRecords: 3,
  affectedBytes: 256,
  requiresApproval: true,
};

const step = {
  id: "0010-example",
  ordinal: 10,
  description: "Upgrade example records.",
  kind: "data" as const,
  stage: "final" as const,
  status: "applied" as const,
  durationMs: 12,
  quarantined: 1,
};

describe("home manifest contracts", () => {
  it("reads strict v1 and v2 manifests", () => {
    assert.deepEqual(
      nerveHomeManifestSchema.parse({ format: "nerve-home", version: 1 }),
      { format: "nerve-home", version: 1 },
    );
    assert.deepEqual(
      nerveHomeManifestSchema.parse({
        format: "nerve-home",
        version: 2,
        homeClass: "disposable",
      }),
      { format: "nerve-home", version: 2, homeClass: "disposable" },
    );
    assert.equal(
      nerveHomeManifestV1Schema.safeParse({
        format: "nerve-home",
        version: 1,
        homeClass: "standard",
      }).success,
      false,
    );
    assert.equal(
      nerveHomeManifestV2Schema.safeParse({
        format: "nerve-home",
        version: 2,
        homeClass: "standard",
        disposable: false,
      }).success,
      false,
    );
  });

  it("writes fresh homes as v2 standard homes", () => {
    assert.deepEqual(NERVE_HOME_MANIFEST, {
      format: "nerve-home",
      version: 2,
      homeClass: "standard",
    });
  });
});

describe("unified home migration contracts", () => {
  it("validates planner outcomes and strict summaries", () => {
    const plan = homeMigrationPlanSchema.parse({
      format: "nerve-home-migration-plan",
      version: 1,
      fingerprint,
      outcome: "pending",
      homeClass: "standard",
      buildId: "0.32.0+abc123",
      steps: [step],
      quarantine,
      requiredBytes: 1024,
      availableBytes: 2048,
    });
    assert.equal(plan.outcome, "pending");
    assert.equal(plan.quarantine?.entries[0]?.requiresApproval, true);
    assert.equal(
      homeMigrationPlanSchema.safeParse({ ...plan, unexpected: true }).success,
      false,
    );
    assert.equal(
      homeMigrationPlanSchema.safeParse({ ...plan, outcome: "unknown" })
        .success,
      false,
    );
  });

  it("validates fingerprinted approvals and migration results", () => {
    assert.deepEqual(
      homeMigrationApprovalSchema.parse({
        fingerprint,
        approvedQuarantineIds: ["quarantine-1"],
      }),
      { fingerprint, approvedQuarantineIds: ["quarantine-1"] },
    );

    const result = homeMigrationResultSchema.parse({
      format: "nerve-home-migration-result",
      version: 1,
      runId: "run-1",
      planFingerprint: fingerprint,
      outcome: "migrated",
      startedAt: "2026-09-27T10:00:00.000Z",
      completedAt: "2026-09-27T10:00:01.000Z",
      steps: [step],
      quarantine,
      snapshotPath: "/tmp/home/backups/storage/snapshot",
    });
    assert.equal(result.steps[0]?.quarantined, 1);
  });

  it("supports structured progress and failures while retaining legacy phases", () => {
    assert.equal(
      homeMigrationProgressSchema.safeParse({
        phase: "conversations",
        message: "Migrating conversations.",
      }).success,
      true,
    );
    const progress = homeMigrationProgressSchema.parse({
      phase: "apply",
      message: "Step failed.",
      completed: 2,
      total: 3,
      step,
      quarantine,
      failure: {
        code: "STEP_FAILED",
        phase: "apply",
        message: "A record could not be migrated.",
        retryable: false,
        stepId: step.id,
        recordKey: "conversation-1",
        appVersion: "0.32.0",
        gitSha: "abc123",
      },
    });
    assert.equal(progress.failure?.code, "STEP_FAILED");
    assert.equal(
      homeMigrationProgressSchema.safeParse({
        phase: "apply",
        message: "Bad counters.",
        completed: 4,
        total: 3,
      }).success,
      false,
    );
  });
});
