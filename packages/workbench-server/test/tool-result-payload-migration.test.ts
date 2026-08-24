import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts";
import { ConversationJournalRepository } from "../src/domains/conversations/conversation-journal.repository.js";
import { decode } from "../src/infrastructure/canonical-store/payload-codecs.js";
import type { MigrationContext } from "../src/infrastructure/migrations/migration.js";
import { migration0019 } from "../src/infrastructure/migrations/migrations/0019-tool-result-payload-files.js";
import {
  initializeStorage,
  storagePaths,
} from "../src/infrastructure/storage/index.js";
import type { SerializedConversationState } from "../src/domains/conversations/conversation-state-materializer.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

it("migrates truncated results to payloads and retires conversation files", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-payload-migration-"));
  roots.push(home);
  const storage = await initializeStorage(home);
  const raw = Array.from({ length: 300 }, (_, index) => `line ${index}`).join(
    "\n",
  );
  const rawPath = join(home, "tmp", "tool-results", "tool_test.json");
  await mkdir(join(home, "tmp", "tool-results"), { recursive: true });
  await writeFile(
    rawPath,
    `${JSON.stringify({ content: raw, contentBlocks: [{ type: "text", text: raw }] }, null, 2)}\n`,
  );
  const now = "2026-08-25T00:00:00.000Z";
  const toolCall: ToolCallRecord = {
    id: "tool_test",
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "bash",
    risk: "command",
    args: { command: "seq 1 300" },
    cwd: "/tmp/project",
    status: "completed",
    revision: 1,
    attempt: 1,
    interactions: [],
    result: {
      content: raw,
      contentBlocks: [{ type: "text", text: raw }],
      details: { rawResultPath: rawPath },
    },
    createdAt: now,
    updatedAt: now,
    settledAt: now,
  };
  const journal = new ConversationJournalRepository(storage);
  await journal.commit("conv_test", {
    kind: "tool_call.created",
    events: [
      { kind: "tool_call.upserted", conversationId: "conv_test", toolCall },
      {
        kind: "tool_call.upserted",
        conversationId: "conv_test",
        toolCall: {
          ...toolCall,
          id: "tool_small",
          result: "fits unchanged",
        },
      },
    ],
  });
  await storage.canonicalStore.close();
  await rm(join(home, "migrations", ".tool-result-payload-files-v1"), {
    force: true,
  });
  await mkdir(join(home, "conversations", "conv_test"), { recursive: true });
  await writeFile(
    join(home, "conversations", "conv_test", "events.jsonl"),
    "{}\n",
  );

  const database = new DatabaseSync(storage.paths.sqlitePath);
  const paths = storagePaths(home);
  const context: MigrationContext = {
    paths,
    now: () => new Date("2026-08-25T01:00:00.000Z"),
    diagnostic: () => undefined,
    withDatabase: (operation) => operation(database),
    transaction: (operation) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = operation(database);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
  try {
    await migration0019.up(context);
    await migration0019.verify(context);
    const row = database
      .prepare(
        `SELECT data FROM domain_documents
         WHERE namespace = 'conversation_state'
           AND scope_id = 'conv_test' AND document_id = 'state'`,
      )
      .get() as { data: Uint8Array };
    const state = decode(row.data) as SerializedConversationState;
    const migrated = state.toolCalls.find(([id]) => id === "tool_test")?.[1];
    const small = state.toolCalls.find(([id]) => id === "tool_small")?.[1];
    assert.ok(migrated?.resultPayload);
    assert.equal(migrated.resultPayload.completeness, "complete");
    assert.equal(migrated.resultPreview !== undefined, true);
    assert.equal(JSON.stringify(migrated).includes("rawResultPath"), false);
    assert.equal(small?.result, "fits unchanged");
    assert.equal(small?.resultPayload, undefined);
    const payloadPath = join(
      home,
      "payloads",
      "conversations",
      "conv_test",
      "tool-calls",
      "tool_test.json",
    );
    assert.match(await readFile(payloadPath, "utf8"), /line 299/);
    await assert.rejects(
      readFile(join(home, "conversations", "conv_test", "events.jsonl")),
    );
  } finally {
    database.close();
  }
});
