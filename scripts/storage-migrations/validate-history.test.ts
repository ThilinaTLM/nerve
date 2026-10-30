import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { validateHistory } from "./validate-history.js";

// Minimal raw-row fixtures: the rehearsal must decode all JSON columns itself,
// then apply the same full-row contracts used by storage repositories.
void test("offline history gate visits every event and tool row and groups bounded diagnostics", (t) => {
  const home = mkdtempSync(join(tmpdir(), "validate-migration-history-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, "data"));
  const db = new DatabaseSync(join(home, "data/nerve.sqlite"));
  db.exec(`CREATE TABLE conversation_event (
    id TEXT, conversation_id TEXT, sequence INTEGER, previous_event_id TEXT,
    event_type TEXT, llm_representation TEXT, turn_id TEXT, input_id TEXT,
    payload TEXT, created_at TEXT);
    CREATE TABLE tool_call (
    id TEXT, conversation_id TEXT, turn_id TEXT, provider_call_id TEXT, assistant_event_id TEXT,
    content_index INTEGER, origin TEXT, tool_name TEXT, arguments TEXT, state TEXT,
    supervision TEXT, interaction TEXT, execution_claim TEXT, updated_at TEXT);`);
  const payload = {
    text: "Message",
    originalText: "Message",
    source: "user",
    senderConversationId: null,
    commandPreparation: null,
  };
  const event = db.prepare(
    "INSERT INTO conversation_event VALUES (?, 'conversation', ?, NULL, 'user_message', 'user', NULL, NULL, ?, '2026-10-30T00:00:00.000Z')",
  );
  event.run("valid", 1, JSON.stringify(payload));
  for (let i = 0; i < 5; i++)
    event.run(
      `invalid-${i}`,
      i + 2,
      JSON.stringify({ ...payload, text: null }),
    );
  event.run("invalid-json", 7, "broken JSON");
  const call = db.prepare(
    "INSERT INTO tool_call VALUES (?, 'conversation', 'turn', NULL, NULL, NULL, 'user', 'plan_present', '{}', 'ready', NULL, ?, NULL, '2026-10-30T00:00:00.000Z')",
  );
  const request = {
    assetId: "plan",
    path: "plan.md",
    targetProfile: { name: "coding", digest: "a".repeat(64) },
    expectedRevision: 0,
    expectedDigest: "b".repeat(64),
  };
  call.run("valid-call", null);
  call.run(
    "missing-confirmation",
    JSON.stringify({
      kind: "plan_review",
      request,
      resolution: { kind: "plan_review", decision: "approve" },
    }),
  );
  db.close();
  const result = validateHistory(home);
  assert.deepEqual(
    [result.events, result.calls, result.failedEvents, result.failedCalls],
    [7, 2, 6, 1],
  );
  assert.equal(
    result.failures.find((entry) => entry.reason.includes("payload.text"))
      ?.rows,
    5,
  );
  assert.equal(
    result.failures.find((entry) => entry.reason.includes("payload.text"))
      ?.examples.length,
    3,
  );
  assert.equal(
    result.failures.find((entry) =>
      entry.reason.includes("interaction.resolution.confirmation"),
    )?.rows,
    1,
  );
  assert.equal(
    result.failures.find((entry) => entry.reason.includes("invalid_json"))
      ?.rows,
    1,
  );
  // Opening/validating a home never modifies it.
  const checked = new DatabaseSync(join(home, "data/nerve.sqlite"), {
    readOnly: true,
  });
  assert.equal(
    checked
      .prepare("SELECT payload FROM conversation_event WHERE id='invalid-json'")
      .get()!.payload,
    "broken JSON",
  );
  checked.close();
});
