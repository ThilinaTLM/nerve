import assert from "node:assert/strict";
import {
  verifyExport,
  releasedRowDigest,
  type ExportIO,
  type ExportReceipt,
} from "./released-export.js";
import type { ReleasedConversation } from "./released-format.js";

/** Pure pre-DDL gate: no discarded/missing/duplicate row can hide behind a batch
 * success marker. Caller must hold the storage lock and re-read rows in its final
 * transaction before using this result to authorize any future schema change. */
export async function verifyConversationExports(
  io: Pick<ExportIO, "read">,
  rows: readonly ReleasedConversation[],
  receipts: readonly ExportReceipt[],
  allowRetired = false,
  progress?: (done: number) => Promise<void>,
): Promise<void> {
  const expected = new Map(rows.map((row) => [row.conversation_id, row]));
  assert.equal(
    expected.size,
    rows.length,
    "Duplicate released conversation row",
  );
  const seen = new Set<string>();
  await progress?.(0);
  for (const receipt of receipts) {
    if (receipt.rowDigest === undefined) continue;
    const id = receipt.identity.replace(/^conversation:/, "");
    assert(
      receipt.identity === `conversation:${id}` && expected.has(id),
      "Export has no released conversation row",
    );
    assert(!seen.has(id), "Duplicate conversation export");
    seen.add(id);
    const row = expected.get(id)!;
    verifyExport(io, receipt, releasedRowDigest(row), allowRetired);
    const targets = Object.values(receipt.targets).filter(
      (target) => target.kind === "lead" || target.kind === "child",
    );
    assert.equal(
      targets.length,
      1,
      "Conversation export must own exactly one agent document",
    );
    const document = JSON.parse(targets[0].bytes) as {
      context?: { instructions?: string; systemPrompt?: string };
    };
    assert.deepEqual(
      document.context ?? {},
      {
        ...(row.instructions !== null
          ? { instructions: row.instructions }
          : {}),
        ...(row.system_prompt !== null
          ? { systemPrompt: row.system_prompt }
          : {}),
      },
      "Conversation prompt context differs from released SQL",
    );
    assert.equal(
      targets[0].kind,
      row.parent_conversation_id ? "child" : "lead",
      "Conversation export role changed",
    );
    await progress?.(seen.size);
  }
  assert.equal(
    seen.size,
    expected.size,
    "Unverified conversation rows remain; SQL destruction is forbidden",
  );
}

/** Shared by initial, postcommit and rollback verification: SQL owns only these
 * pairs. Prompt context must instead match the verified JSON export exactly. */
export async function verifyConvertedConversationData(
  actual: readonly Readonly<Record<string, unknown>>[],
  rows: readonly ReleasedConversation[],
  receipts: readonly ExportReceipt[],
  io: Pick<ExportIO, "read">,
  progress?: (done: number) => Promise<void>,
): Promise<void> {
  assert.deepEqual(
    actual.map((row) => [row.conversation_id, row.working_directory]),
    rows.map((row) => [row.conversation_id, row.working_directory]),
    "Working directory changed during rebuild",
  );
  await verifyConversationExports(io, rows, receipts, true, progress);
}
