import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { QueuedPromptRecord } from "@nervekit/contracts/agents";
import { CanonicalRunStartService } from "../../../src/domains/conversations/timeline/canonical-run-start.service.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

test("queued prompt acceptance and user history commit are atomic", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-queue-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const now = "2026-09-14T00:00:00.000Z";
  const prompt: QueuedPromptRecord = {
    id: "promptq_atomic",
    agentId: "agent_atomic",
    conversationId: "conv_atomic",
    projectId: "proj_atomic",
    behavior: "follow-up",
    text: "continue",
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  await store.writeDocument({
    namespace: "canonical_prompt_queue",
    scopeId: prompt.agentId,
    documentId: prompt.id,
    data: prompt,
    expectedRevision: 0,
    now,
  });
  const result = await new CanonicalRunStartService(store).start({
    conversationId: prompt.conversationId,
    runId: "run_atomic",
    agentId: prompt.agentId,
    prompt: prompt.text,
    providerIdentity: { provider: "test", model: "test" },
    providerCapability: "stateless_generation",
    queuedPrompt: { record: prompt, expectedRevision: 1 },
    now: "2026-09-14T00:00:01.000Z",
  });
  assert.equal(result.kind, "started");
  const delivered = await store.readDocument<QueuedPromptRecord>(
    "canonical_prompt_queue",
    prompt.agentId,
    prompt.id,
  );
  assert.equal(delivered?.data.status, "delivered");
  assert.equal(delivered?.data.runId, "run_atomic");
  assert.match(delivered?.data.deliveredEntryId ?? "", /^entry_/);
});
