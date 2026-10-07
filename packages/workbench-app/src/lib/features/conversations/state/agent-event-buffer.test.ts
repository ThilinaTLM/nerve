import assert from "node:assert/strict";
import { it } from "node:test";
import { AgentEventBuffer } from "./agent-event-buffer";
import type { EventEnvelope } from "$lib/api";
const event = (seq: number): EventEnvelope<Record<string, unknown>> => ({
  id: `evt_${seq}`,
  seq,
  type: "conversation.entry.appended",
  data: {},
  ts: "2026-10-06T00:00:00.000Z",
});

it("keeps post-snapshot live events that arrive during hydration and drops replayed rows", () => {
  const buffer = new AgentEventBuffer();
  buffer.begin();
  assert.equal(buffer.accept(event(12)), false);
  assert.equal(buffer.accept(event(8)), false);
  assert.equal(buffer.accept(event(12)), false);
  assert.equal(buffer.accept(event(11)), false);
  assert.deepEqual(
    buffer.finish(10).map((item) => item.seq),
    [11, 12],
  );
  assert.equal(buffer.accept(event(12)), false);
  assert.equal(buffer.accept(event(13)), true);
});
it("failed hydration does not discard live events or share a sibling's cursor", () => {
  const first = new AgentEventBuffer();
  const sibling = new AgentEventBuffer();
  assert.equal(first.accept(event(100)), true);
  first.begin();
  first.accept(event(101));
  assert.deepEqual(
    first.finish(-1).map((item) => item.seq),
    [101],
  );
  assert.equal(sibling.accept(event(1)), true);
});
