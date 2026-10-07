import assert from "node:assert/strict";
import { it } from "node:test";
import type { AgentRecord } from "$lib/api";
import {
  mergeAgentsByUpdatedAt,
  upsertAgentByUpdatedAt,
} from "./agent-freshness";
const record = (id: string, accepted: number, effective: number): AgentRecord =>
  ({
    id,
    configurationRevision: accepted,
    effectiveConfigurationRevision: effective,
    updatedAt: "2026-10-06T00:00:00.000Z",
  }) as AgentRecord;
it("late same-clock configuration acknowledgments cannot regress accepted/effective settings or another agent", () => {
  const root = record("agent_root", 3, 2);
  const child = record("agent_child", 4, 4);
  const state = [root, child];
  assert.equal(
    upsertAgentByUpdatedAt(record("agent_root", 2, 2), state),
    state,
  );
  assert.equal(
    upsertAgentByUpdatedAt(record("agent_root", 3, 1), state),
    state,
  );
  const merged = mergeAgentsByUpdatedAt(
    [record("agent_root", 2, 1), record("agent_child", 5, 4)],
    state,
  );
  assert.equal(merged[0], root);
  assert.equal(merged[1]?.configurationRevision, 5);
  assert.equal(child.configurationRevision, 4);
});
