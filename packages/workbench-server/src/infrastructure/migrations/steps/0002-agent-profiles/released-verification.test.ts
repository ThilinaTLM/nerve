import { test } from "node:test";
import assert from "node:assert/strict";
import fixture from "../../../../../test/fixtures/storage/releases/0.37.0/agent-conversion-inputs.json" with { type: "json" };
import { convertConversationV037 } from "./released-format.js";
import {
  prepareExport,
  applyExport,
  exportedTarget,
  releasedRowDigest,
  type ExportIO,
} from "./released-export.js";
import {
  verifyConversationExports,
  verifyConvertedConversationData,
} from "./released-verification.js";

await test("the pre-DDL verification gate requires every unchanged released row exactly once", async () => {
  const files = new Map<string, string>();
  const io: ExportIO = {
    read: (path) => files.get(path),
    write: (path, bytes) => {
      files.set(path, bytes);
    },
    remove: (path) => {
      files.delete(path);
    },
  };
  const row = fixture.conversation;
  const document = convertConversationV037(
    row,
    {},
    { builtins: {}, skillSources: {}, report() {} },
  );
  const receipt = prepareExport(io, {
    identity: `conversation:${row.conversation_id}`,
    backupDirectory: "/originals",
    sources: [],
    targets: { "/agent": exportedTarget("lead", document) },
    rowDigest: releasedRowDigest(row),
  });
  applyExport(io, "/receipt", receipt);
  await verifyConversationExports(io, [row], [receipt]);
  await assert.rejects(
    () => verifyConversationExports(io, [row], []),
    /Unverified/,
  );
  await assert.rejects(
    () => verifyConversationExports(io, [row], [receipt, receipt]),
    /Duplicate/,
  );
  await assert.rejects(
    () => verifyConversationExports(io, [row, row], [receipt]),
    /Duplicate/,
  );
  await assert.rejects(
    () =>
      verifyConversationExports(
        io,
        [{ ...row, parent_conversation_id: "parent" }],
        [receipt],
      ),
    /row changed/,
  );
  await assert.rejects(
    () =>
      verifyConversationExports(
        io,
        [{ ...row, instructions: "later edit" }],
        [receipt],
      ),
    /row changed/,
  );
  const missingContext = structuredClone(document);
  delete missingContext.context;
  const corruptTarget = exportedTarget("lead", missingContext);
  files.set("/agent", corruptTarget.bytes);
  await assert.rejects(
    () =>
      verifyConversationExports(
        io,
        [row],
        [{ ...receipt, targets: { "/agent": corruptTarget } }],
      ),
    /prompt context/,
  );
  files.delete("/agent");
  await assert.rejects(
    () => verifyConversationExports(io, [row], [receipt]),
    /Missing or changed export/,
  );
});

function convertedFixture() {
  const files = new Map<string, string>();
  const io: ExportIO = {
    read: (path) => files.get(path),
    write: (path, bytes) => {
      files.set(path, bytes);
    },
    remove: (path) => {
      files.delete(path);
    },
  };
  const rows = [
    {
      ...fixture.conversation,
      conversation_id: "a",
      system_prompt: "Custom base",
      instructions: "Exact local instructions",
    },
    {
      ...fixture.conversation,
      conversation_id: "b",
      system_prompt: null,
      instructions: "",
    },
  ];
  const receipts = rows.map((row) => {
    const source = `/${row.conversation_id}/legacy.json`;
    files.set(source, "legacy bytes");
    const receipt = prepareExport(io, {
      identity: `conversation:${row.conversation_id}`,
      backupDirectory: `/originals/${row.conversation_id}`,
      sources: [source],
      retire: [source],
      targets: {
        [`/${row.conversation_id}/agent.json`]: exportedTarget(
          "lead",
          convertConversationV037(
            row,
            {},
            { builtins: {}, skillSources: {}, report() {} },
          ),
        ),
      },
      rowDigest: releasedRowDigest(row),
    });
    applyExport(io, `/${row.conversation_id}/receipt`, receipt);
    return receipt;
  });
  const actual = rows.map((row) => ({
    conversation_id: row.conversation_id,
    working_directory: row.working_directory,
  }));
  return { files, io, rows, receipts, actual };
}

await test("converted verification compares SQL directory pairs, not legacy prompt quadruples, including postcommit resume", async () => {
  const f = convertedFixture();
  await verifyConvertedConversationData(f.actual, f.rows, f.receipts, f.io);
  for (const receipt of f.receipts)
    for (const path of receipt.retire) f.files.delete(path);
  await verifyConvertedConversationData(f.actual, f.rows, f.receipts, f.io);
  await assert.rejects(
    () =>
      verifyConvertedConversationData(
        [{ ...f.actual[0], working_directory: "/changed" }, f.actual[1]],
        f.rows,
        f.receipts,
        f.io,
      ),
    /Working directory changed/,
  );
  await assert.rejects(
    () =>
      verifyConvertedConversationData(
        f.actual.slice(1),
        f.rows,
        f.receipts,
        f.io,
      ),
    /Working directory changed/,
  );
  await assert.rejects(
    () =>
      verifyConvertedConversationData(
        [{ ...f.actual[0], conversation_id: "wrong" }, f.actual[1]],
        f.rows,
        f.receipts,
        f.io,
      ),
    /Working directory changed/,
  );
});

await test("converted verification requires exact prompt context in verified JSON, independently of correct SQL directories", async () => {
  const f = convertedFixture();
  const path = "/a/agent.json";
  const original = f.receipts[0].targets[path];
  const document = JSON.parse(original.bytes) as {
    context: { instructions?: string; systemPrompt?: string };
  };
  for (const context of [
    {},
    { instructions: "wrong", systemPrompt: "Custom base" },
    { instructions: "Exact local instructions", systemPrompt: "wrong" },
  ]) {
    const target = exportedTarget("lead", { ...document, context });
    f.files.set(path, target.bytes);
    const receipts = [
      { ...f.receipts[0], targets: { [path]: target } },
      f.receipts[1],
    ];
    await assert.rejects(
      () => verifyConvertedConversationData(f.actual, f.rows, receipts, f.io),
      /prompt context/,
    );
  }
  f.files.delete(path);
  await assert.rejects(
    () => verifyConvertedConversationData(f.actual, f.rows, f.receipts, f.io),
    /Missing or changed export/,
  );
});

await test("verification awaits progress and counts only conversation receipts", async () => {
  const f = convertedFixture();
  const counts: number[] = [];
  await verifyConversationExports(
    f.io,
    f.rows,
    [
      { ...f.receipts[0], identity: "scope:user", rowDigest: undefined },
      ...f.receipts,
    ],
    false,
    async (done) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      counts.push(done);
    },
  );
  assert.deepEqual(counts, [0, 1, 2]);
  counts.length = 0;
  await verifyConvertedConversationData(
    f.actual,
    f.rows,
    f.receipts,
    f.io,
    async (done) => {
      counts.push(done);
    },
  );
  assert.deepEqual(counts, [0, 1, 2]);
});
