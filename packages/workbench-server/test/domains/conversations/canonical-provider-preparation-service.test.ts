import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalProviderPreparationService } from "../../../src/domains/conversations/timeline/canonical-provider-preparation.service.js";
import { CanonicalProviderDispatchService } from "../../../src/domains/conversations/timeline/canonical-provider-dispatch.service.js";
import { CanonicalProviderSettlementService } from "../../../src/domains/conversations/timeline/canonical-provider-settlement.service.js";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalToolDispatchService } from "../../../src/domains/conversations/timeline/canonical-tool-dispatch.service.js";
import { CanonicalToolSettlementService } from "../../../src/domains/conversations/timeline/canonical-tool-settlement.service.js";
import { CanonicalContinuationService } from "../../../src/domains/conversations/timeline/canonical-continuation.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

test("INV-PROVIDER-01 freezes the first request and schedules claim work atomically", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-provider-prepare-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const started = await new CanonicalRunStartService(store).start({
    conversationId: "conv_provider",
    runId: "run_provider",
    agentId: "agent_provider",
    providerIdentity: { provider: "test", model: "test-model" },
    providerCapability: "stateless_generation",
    prompt: "hello",
    now: "2026-09-14T00:00:00.000Z",
  });
  assert.equal(started.kind, "started");
  assert.equal(started.kind === "started" && started.run.revision, 1);

  const claimed = await store.execution.claimReadyLifecycleWork({
    workerId: "provider-preparer-1",
    now: "2026-09-14T00:00:01.000Z",
    leaseDurationMs: 30_000,
  });
  assert.equal(claimed?.kind, "prepare_provider_request");
  assert.equal(claimed?.state, "leased");
  const service = new CanonicalProviderPreparationService(store);
  const input = {
    workId: claimed!.workId,
    workerId: "provider-preparer-1",
    conversationId: "conv_provider",
    runId: "run_provider",
    phaseId: "provider_phase_provider_1",
    request: {
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
      temperature: 0,
    },
    now: "2026-09-14T00:00:02.000Z",
  };
  const prepared = await service.commitPreparedRequest(input);
  assert.equal(prepared.kind, "committed");
  assert.equal(prepared.kind !== "rejected" && prepared.phase.state, "ready");
  assert.match(
    prepared.kind !== "rejected" ? (prepared.phase.requestHash ?? "") : "",
    /^sha256:[a-f0-9]{64}$/,
  );
  assert.equal(
    (await store.execution.readLifecycleWork(claimed!.workId))?.state,
    "settled",
  );
  const ready = await store.execution.listReadyLifecycleWork(
    "2026-09-14T00:00:03.000Z",
    10,
  );
  assert.deepEqual(
    ready.map((work) => [work.kind, work.providerPhaseId]),
    [["claim_provider_attempt", "provider_phase_provider_1"]],
  );
  assert.equal(
    (await service.commitPreparedRequest(input)).kind,
    "receipt_replay",
  );

  const claimWork = await store.execution.claimReadyLifecycleWork({
    workerId: "provider-claimer-1",
    now: "2026-09-14T00:00:03.000Z",
    leaseDurationMs: 30_000,
  });
  assert.equal(claimWork?.kind, "claim_provider_attempt");
  const dispatchService = new CanonicalProviderDispatchService(store);
  const claimInput = {
    workId: claimWork!.workId,
    workerId: "provider-claimer-1",
    conversationId: "conv_provider",
    runId: "run_provider",
    phaseId: "provider_phase_provider_1",
    now: "2026-09-14T00:00:04.000Z",
    claimLeaseDurationMs: 30_000,
  };
  const authorized = await dispatchService.authorizeFirstAttempt(claimInput);
  assert.equal(authorized.kind, "committed");
  assert.equal(
    authorized.kind !== "rejected" && authorized.snapshot.phase.state,
    "active",
  );
  assert.equal(
    authorized.kind !== "rejected" && authorized.snapshot.attempt.state,
    "claimed",
  );
  assert.equal(
    (await dispatchService.authorizeFirstAttempt(claimInput)).kind,
    "receipt_replay",
  );
  const dispatchWork = await store.execution.claimReadyLifecycleWork({
    workerId: "provider-dispatcher-1",
    now: "2026-09-14T00:00:05.000Z",
    leaseDurationMs: 15_000,
  });
  assert.equal(dispatchWork?.kind, "dispatch_provider_attempt");
  const dispatched =
    authorized.kind === "rejected"
      ? authorized
      : await dispatchService.markDispatched(authorized.snapshot, {
          workerId: "provider-dispatcher-1",
          now: "2026-09-14T00:00:06.000Z",
        });
  assert.equal(dispatched.kind, "committed");
  assert.equal(
    dispatched.kind !== "rejected" &&
      (await dispatchService.revalidateBeforeDispatch(dispatched.snapshot, {
        workerId: "provider-dispatcher-1",
        now: "2026-09-14T00:00:07.000Z",
      })),
    true,
  );
  assert.notEqual(dispatched.kind, "rejected");
  if (dispatched.kind === "rejected") return;
  const settled = await new CanonicalProviderSettlementService(
    store,
  ).commitResponse({
    snapshot: dispatched.snapshot,
    workerId: "provider-dispatcher-1",
    response: { id: "provider-response-1", finishReason: "stop" },
    entries: [
      {
        entryId: "entry_provider_tool_response",
        kind: "assistant_message",
        inlineContent: { text: "world" },
        provenance: { agentId: "agent_provider" },
      },
    ],
    toolProposals: [
      {
        admission: "authorized",
        providerToolCallId: "provider-call-1",
        toolName: "read",
        normalizedInputFingerprint: `sha256:${"a".repeat(64)}`,
        normalizedInput: { path: "README.md" },
        cwd: "/tmp/project",
        risk: "read",
        capability: {
          kind: "contractually_replay_safe_effect",
          version: 1,
          externalKeyEncoding: "provider-call-id",
          externalKeyScope: "conversation",
          retentionWindowMs: 60_000,
          reconciliation: "supported",
        },
        policyObservation: {
          schemaVersion: 1,
          observationId: "policy_observation_provider_tool_1",
          scope: { kind: "conversation", ownerId: "conv_provider" },
          documentIdentity: "permissions.json",
          completeDocumentDigest: `sha256:${"b".repeat(64)}`,
          selectedRuleSetId: "coding",
          selectedRuleSetDigest: `sha256:${"c".repeat(64)}`,
          applicableOverlayDigests: [],
          normalizedInputFingerprint: `sha256:${"a".repeat(64)}`,
          trustEvidence: { source: "test" },
          observedAt: "2026-09-14T00:00:07.500Z",
        },
        authorizationEvidence: { decision: "allow" },
        externalScope: { conversationId: "conv_provider" },
        externalKey: "provider-call-1",
        owner: { conversationId: "conv_provider", projectId: "project_test" },
      },
    ],
    now: "2026-09-14T00:00:08.000Z",
  });
  assert.equal(settled.kind, "committed");
  assert.equal(
    (await store.execution.readProviderPhase("provider_phase_provider_1"))
      ?.state,
    "committed",
  );
  assert.equal(
    (await store.execution.readAttempt("attempt_provider_provider_1_1"))?.state,
    "succeeded",
  );
  assert.equal(
    (await store.execution.readClaim("claim_provider_provider_1_1"))?.state,
    "consumed",
  );
  assert.equal(
    (
      await store.execution.readLifecycleWork(
        "canonical_work_provider_1_dispatch_1",
      )
    )?.state,
    "settled",
  );
  const toolRun = await store.readTimelineRunControl(
    "conv_provider",
    "run_provider",
  );
  assert.equal(toolRun?.providerPhaseId, null);
  assert.equal(toolRun?.state, "partially_waiting");
  assert.match(toolRun?.waitGroupId ?? "", /^wait_group_/);
  const toolClaimWork = await store.execution.claimReadyLifecycleWork({
    workerId: "tool-claimer-1",
    now: "2026-09-14T00:00:09.000Z",
    leaseDurationMs: 30_000,
  });
  assert.equal(toolClaimWork?.kind, "claim_tool_attempt");
  const toolInput = await store.execution.readArtifactManifest(
    toolClaimWork!.inputManifestId!,
  );
  assert.deepEqual(
    (toolInput as { normalizedInput?: unknown }).normalizedInput,
    { path: "README.md" },
  );
  const toolDispatch = new CanonicalToolDispatchService(store);
  const toolClaimed = await toolDispatch.authorizeFirstAttempt({
    workId: toolClaimWork!.workId,
    workerId: "tool-claimer-1",
    conversationId: "conv_provider",
    runId: "run_provider",
    effectId: toolClaimWork!.effectId!,
    now: "2026-09-14T00:00:10.000Z",
    claimLeaseDurationMs: 30_000,
  });
  assert.equal(toolClaimed.kind, "committed");
  assert.equal(
    toolClaimed.kind !== "rejected" && toolClaimed.snapshot.effect.state,
    "dispatching",
  );
  assert.deepEqual(
    toolClaimed.kind !== "rejected" && toolClaimed.snapshot.effect.capability,
    {
      kind: "contractually_replay_safe_effect",
      version: 1,
      externalKeyEncoding: "provider-call-id",
      externalKeyScope: "conversation",
      retentionWindowMs: 60_000,
      reconciliation: "supported",
    },
  );
  assert.equal(
    toolClaimed.kind !== "rejected" && toolClaimed.snapshot.authorization.state,
    "consumed",
  );
  assert.notEqual(toolClaimed.kind, "rejected");
  if (toolClaimed.kind === "rejected") return;
  const toolDispatchWork = await store.execution.claimReadyLifecycleWork({
    workId: toolClaimed.snapshot.work.workId,
    workerId: "tool-dispatcher-1",
    now: "2026-09-14T00:00:11.000Z",
    leaseDurationMs: 30_000,
  });
  assert.equal(toolDispatchWork?.kind, "dispatch_tool_attempt");
  const toolDispatched = await toolDispatch.markDispatched(
    { ...toolClaimed.snapshot, work: toolDispatchWork! },
    {
      workerId: "tool-dispatcher-1",
      now: "2026-09-14T00:00:12.000Z",
    },
  );
  assert.equal(toolDispatched.kind, "committed");
  assert.notEqual(toolDispatched.kind, "rejected");
  if (toolDispatched.kind === "rejected") return;
  assert.equal(
    await toolDispatch.revalidateBeforeDispatch(toolDispatched.snapshot, {
      workerId: "tool-dispatcher-1",
      now: "2026-09-14T00:00:13.000Z",
    }),
    true,
  );
  const toolSettled = await new CanonicalToolSettlementService(
    store,
  ).commitResult({
    snapshot: toolDispatched.snapshot,
    workerId: "tool-dispatcher-1",
    resultEntryId: "entry_provider_tool_result_1",
    result: { status: "completed", text: "result" },
    exactHarnessMessage: {
      role: "toolResult",
      toolCallId: "provider-call-1",
      toolName: "read",
      content: [{ type: "text", text: "result" }],
      isError: false,
      timestamp: Date.parse("2026-09-14T00:00:14.000Z"),
    },
    failed: false,
    providerIdentity: { provider: "test", model: "test-model" },
    providerCapability: "stateless_generation",
    now: "2026-09-14T00:00:14.000Z",
  });
  assert.equal(toolSettled.kind, "committed");
  const settledRun = await store.readTimelineRunControl(
    "conv_provider",
    "run_provider",
  );
  assert.equal(settledRun?.state, "waiting");
  assert.match(settledRun?.waitGroupId ?? "", /^wait_group_/);
  assert.equal(settledRun?.providerPhaseId, null);
  assert.equal(
    (
      await store.execution.readWaitGroup(
        toolClaimed.snapshot.waitGroup.waitGroupId,
      )
    )?.state,
    "ready",
  );
  const continuationWork = await store.execution.claimReadyLifecycleWork({
    workerId: "continuation-worker-1",
    now: "2026-09-14T00:00:15.000Z",
    leaseDurationMs: 30_000,
  });
  assert.equal(continuationWork?.kind, "prepare_continuation");
  const continued = await new CanonicalContinuationService(
    store,
  ).commitWithoutCompaction({
    continuationWork: continuationWork!,
    workerId: "continuation-worker-1",
    compactionDecisionEvidence: {
      contextTokens: 100,
      thresholdTokens: 1_000,
    },
    now: "2026-09-14T00:00:16.000Z",
  });
  assert.equal(continued.kind, "committed");
  const continuedRun = await store.readTimelineRunControl(
    "conv_provider",
    "run_provider",
  );
  assert.equal(continuedRun?.state, "running");
  assert.equal(continuedRun?.waitGroupId, null);
  assert.match(continuedRun?.providerPhaseId ?? "", /^provider_phase_/);
  assert.equal(
    continued.kind !== "rejected" && continued.work.kind,
    "prepare_provider_request",
  );
  assert.equal(
    (
      await store.execution.readWaitGroup(
        toolClaimed.snapshot.waitGroup.waitGroupId,
      )
    )?.state,
    "closed",
  );
});

test("INV-PROVIDER-01 refuses preparation after scheduler lease expiry", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-provider-expiry-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  await new CanonicalRunStartService(store).start({
    conversationId: "conv_expiry",
    runId: "run_expiry",
    agentId: "agent_expiry",
    providerIdentity: { provider: "test", model: "test-model" },
    providerCapability: "stateless_generation",
    prompt: "hello",
    now: "2026-09-14T00:00:00.000Z",
  });
  const claimed = await store.execution.claimReadyLifecycleWork({
    workerId: "expired-worker",
    now: "2026-09-14T00:00:01.000Z",
    leaseDurationMs: 1_000,
  });
  assert.ok(claimed);
  const rejected = await new CanonicalProviderPreparationService(
    store,
  ).commitPreparedRequest({
    workId: claimed.workId,
    workerId: "expired-worker",
    conversationId: "conv_expiry",
    runId: "run_expiry",
    phaseId: "provider_phase_expiry_1",
    request: { model: "test-model", messages: [] },
    now: "2026-09-14T00:00:02.000Z",
  });
  assert.equal(rejected.kind, "rejected");
  const recovered = await store.execution.recoverExpiredLifecycleWork({
    now: "2026-09-14T00:00:03.000Z",
    limit: 10,
  });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.state, "ready");
  assert.equal(recovered[0]?.leaseOwner, undefined);
});
