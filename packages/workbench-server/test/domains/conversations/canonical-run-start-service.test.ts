import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

test("INV-HEAD-01 accepts a prompt and foreground owner in one transition", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-run-start-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const service = new CanonicalRunStartService(store);
  const input = {
    conversationId: "conv_start",
    runId: "run_start",
    agentId: "agent_start",
    providerIdentity: { provider: "test", model: "test" },
    providerCapability: "stateless_generation" as const,
    prompt: "hello",
    commandId: "command-start",
    now: "2026-09-12T00:00:00.000Z",
  };
  const started = await service.start(input);
  assert.equal(started.kind, "started");
  const replay = await service.start(input);
  assert.equal(replay.kind, "receipt_replay");
  assert.deepEqual(
    replay.kind === "receipt_replay" ? replay.run : undefined,
    started.kind === "started" ? started.run : undefined,
  );
  const head = await store.readTimelineConversationHead("conv_start");
  assert.equal(head?.revision, 1);
  assert.equal(head?.foregroundRunId, "run_start");
  assert.equal(
    started.kind === "started" && started.run.providerPhaseId,
    "provider_phase_start_1",
  );
  const work = await store.execution.readLifecycleWork(
    "canonical_work_start_provider_1",
  );
  assert.equal(work?.providerPhaseId, "provider_phase_start_1");
  assert.equal(work?.kind, "prepare_provider_request");
  assert.equal(work?.state, "ready");
  assert.equal(
    head?.activeEntryId,
    started.kind === "started" ? started.run.continuationEntryId : null,
  );
});
