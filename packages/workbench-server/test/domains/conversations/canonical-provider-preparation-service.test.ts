import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalProviderPreparationService } from "../../../src/domains/conversations/timeline/canonical-provider-preparation.service.js";
import { CanonicalProviderDispatchService } from "../../../src/domains/conversations/timeline/canonical-provider-dispatch.service.js";
import { CanonicalProviderSettlementService } from "../../../src/domains/conversations/timeline/canonical-provider-settlement.service.js";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
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
        kind: "assistant_message",
        inlineContent: { text: "world" },
        provenance: { agentId: "agent_provider" },
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
  assert.equal(
    (await store.readTimelineRunControl("conv_provider", "run_provider"))
      ?.providerPhaseId,
    null,
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
});
