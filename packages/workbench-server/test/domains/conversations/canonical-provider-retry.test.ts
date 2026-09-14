import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalProviderDispatchService } from "../../../src/domains/conversations/timeline/canonical-provider-dispatch.service.js";
import { CanonicalProviderPreparationService } from "../../../src/domains/conversations/timeline/canonical-provider-preparation.service.js";
import { CanonicalProviderSettlementService } from "../../../src/domains/conversations/timeline/canonical-provider-settlement.service.js";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

test("INV-PROVIDER-01 records known failure before scheduling canonical retry", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-provider-retry-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });

  await new CanonicalRunStartService(store).start({
    conversationId: "conv_retry",
    runId: "run_retry",
    agentId: "agent_retry",
    providerIdentity: { provider: "test", model: "test-model" },
    providerCapability: "stateless_generation",
    prompt: "hello",
    now: "2026-09-14T00:00:00.000Z",
  });
  const preparationWork = await store.execution.claimReadyLifecycleWork({
    workerId: "prepare",
    now: "2026-09-14T00:00:01.000Z",
    leaseDurationMs: 30_000,
  });
  assert.equal(preparationWork?.kind, "prepare_provider_request");
  const prepared = await new CanonicalProviderPreparationService(
    store,
  ).commitPreparedRequest({
    workId: preparationWork!.workId,
    workerId: "prepare",
    conversationId: "conv_retry",
    runId: "run_retry",
    phaseId: preparationWork!.providerPhaseId!,
    request: { model: "test-model", messages: [] },
    now: "2026-09-14T00:00:02.000Z",
  });
  assert.notEqual(prepared.kind, "rejected");

  const claimWork = await store.execution.claimReadyLifecycleWork({
    workerId: "claim",
    now: "2026-09-14T00:00:03.000Z",
    leaseDurationMs: 30_000,
  });
  const dispatch = new CanonicalProviderDispatchService(store);
  const authorized = await dispatch.authorizeFirstAttempt({
    workId: claimWork!.workId,
    workerId: "claim",
    conversationId: "conv_retry",
    runId: "run_retry",
    phaseId: claimWork!.providerPhaseId!,
    now: "2026-09-14T00:00:04.000Z",
    claimLeaseDurationMs: 30_000,
  });
  assert.notEqual(authorized.kind, "rejected");
  if (authorized.kind === "rejected") return;
  const dispatchWork = await store.execution.claimReadyLifecycleWork({
    workerId: "dispatch",
    now: "2026-09-14T00:00:05.000Z",
    leaseDurationMs: 30_000,
  });
  assert.equal(dispatchWork?.kind, "dispatch_provider_attempt");
  const dispatched = await dispatch.markDispatched(authorized.snapshot, {
    workerId: "dispatch",
    now: "2026-09-14T00:00:06.000Z",
  });
  assert.notEqual(dispatched.kind, "rejected");
  if (dispatched.kind === "rejected") return;

  const failed = await new CanonicalProviderSettlementService(
    store,
  ).commitKnownFailure({
    snapshot: dispatched.snapshot,
    workerId: "dispatch",
    error: "rate limited",
    retryAt: "2026-09-14T00:00:20.000Z",
    now: "2026-09-14T00:00:07.000Z",
  });
  assert.equal(failed.kind, "committed");
  assert.equal(
    (await store.execution.readAttempt(dispatched.snapshot.attempt.attemptId))
      ?.state,
    "known_failed",
  );
  assert.equal(
    (await store.execution.readProviderPhase(dispatched.snapshot.phase.phaseId))
      ?.state,
    "closed",
  );
  assert.deepEqual(
    await store.execution.listReadyLifecycleWork(
      "2026-09-14T00:00:19.999Z",
      10,
    ),
    [],
  );
  const retryWork = await store.execution.listReadyLifecycleWork(
    "2026-09-14T00:00:20.000Z",
    10,
  );
  assert.equal(retryWork.length, 1);
  assert.equal(retryWork[0]?.kind, "prepare_provider_request");
  const retryPhase = await store.execution.readProviderPhase(
    retryWork[0]!.providerPhaseId!,
  );
  assert.equal(retryPhase?.state, "preparing");
  assert.equal(retryPhase?.providerIdentity.canonicalRetryNumber, 1);
  assert.equal(
    (await store.readTimelineRunControl("conv_retry", "run_retry"))
      ?.providerPhaseId,
    retryPhase?.phaseId,
  );

  const replay = await new CanonicalProviderSettlementService(
    store,
  ).commitKnownFailure({
    snapshot: dispatched.snapshot,
    workerId: "dispatch",
    error: "rate limited",
    retryAt: "2026-09-14T00:00:20.000Z",
    now: "2026-09-14T00:00:07.000Z",
  });
  assert.equal(replay.kind, "receipt_replay", JSON.stringify(replay));
});
