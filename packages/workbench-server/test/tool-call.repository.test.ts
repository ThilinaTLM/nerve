import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts";
import { ToolCallRepository } from "../src/domains/tools/tool-call.repository.js";
import { IndexStore } from "../src/infrastructure/index-store/index.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];
const now = "2026-07-25T00:00:00.000Z";

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

function toolCall(id: string, updatedAt = now): ToolCallRecord {
  return {
    id,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "read",
    risk: "read",
    args: { path: "README.md" },
    cwd: "/tmp/project",
    status: "completed",
    createdAt: now,
    updatedAt,
  } as ToolCallRecord;
}

describe("ToolCallRepository compaction", () => {
  it("compacts amplified history and preserves a concurrent upsert", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-repository-"));
    roots.push(home);
    const storage = await initializeStorage(home);
    const index = new IndexStore(storage.paths.sqlitePath);
    index.initialize();
    const path = join(home, "logs", "tool-calls.jsonl");
    const first = toolCall("tool_first");
    const latest = toolCall("tool_first", "2026-07-25T00:00:01.000Z");
    await writeFile(
      path,
      [first, latest, latest].map((value) => JSON.stringify(value)).join("\n") +
        "\n",
    );
    const repository = new ToolCallRepository(storage, index, {
      compactionMinimumBytes: 1,
      compactionAmplification: 2,
    });
    await repository.hydrate();

    const compacting = repository.compactPersistedIfAmplified();
    const added = toolCall("tool_added", "2026-07-25T00:00:02.000Z");
    await repository.upsert(added);
    const result = await compacting;

    assert.ok(result);
    const lines = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ToolCallRecord);
    assert.deepEqual(
      new Set(lines.map((record) => record.id)),
      new Set(["tool_first", "tool_added"]),
    );
    const restarted = new ToolCallRepository(storage, index);
    assert.deepEqual(
      new Set((await restarted.hydrate()).map((record) => record.id)),
      new Set(["tool_first", "tool_added"]),
    );
    index.close();
  });

  it("does not compact a journal below the configured threshold", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-repository-"));
    roots.push(home);
    const storage = await initializeStorage(home);
    const index = new IndexStore(storage.paths.sqlitePath);
    index.initialize();
    const repository = new ToolCallRepository(storage, index, {
      compactionMinimumBytes: Number.MAX_SAFE_INTEGER,
    });
    await repository.hydrate();
    assert.equal(await repository.compactPersistedIfAmplified(), undefined);
    index.close();
  });
});

describe("ToolCallRepository snapshot hydration", () => {
  it("loads from the persisted snapshot when the journal watermark matches", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-snapshot-"));
    roots.push(home);
    const storage = await initializeStorage(home);
    const path = join(home, "logs", "tool-calls.jsonl");
    await writeFile(
      path,
      [toolCall("tool_a"), toolCall("tool_b")]
        .map((value) => JSON.stringify(value))
        .join("\n") + "\n",
    );
    const index = new IndexStore(storage.paths.sqlitePath);
    index.initialize();
    const first = new ToolCallRepository(storage, index);
    assert.equal((await first.hydrate()).length, 2);
    assert.equal(first.hydrationSource, "journal");
    await first.markToolCallSnapshotPersisted();
    index.close();

    // Corrupting the journal (same byte length, so the watermark still
    // matches) proves the snapshot path never re-reads it: a journal-based
    // hydrate would fail to parse this content.
    const originalSize = (await stat(path)).size;
    await writeFile(path, `${"X".repeat(originalSize - 1)}\n`);
    const reopened = new IndexStore(storage.paths.sqlitePath);
    reopened.initialize();
    const second = new ToolCallRepository(storage, reopened);
    const records = await second.hydrate();
    assert.equal(second.hydrationSource, "snapshot");
    assert.deepEqual(
      new Set(records.map((record) => record.id)),
      new Set(["tool_a", "tool_b"]),
    );
    reopened.close();
  });

  it("falls back to the journal when the watermark no longer matches", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-snapshot-"));
    roots.push(home);
    const storage = await initializeStorage(home);
    const path = join(home, "logs", "tool-calls.jsonl");
    await writeFile(path, JSON.stringify(toolCall("tool_a")) + "\n");
    const index = new IndexStore(storage.paths.sqlitePath);
    index.initialize();
    const first = new ToolCallRepository(storage, index);
    await first.hydrate();
    await first.markToolCallSnapshotPersisted();
    index.close();

    // Simulate a crash between a journal append and the snapshot meta sync.
    await writeFile(
      path,
      JSON.stringify(toolCall("tool_a")) +
        "\n" +
        JSON.stringify(toolCall("tool_b", "2026-07-25T00:00:02.000Z")) +
        "\n",
    );
    const reopened = new IndexStore(storage.paths.sqlitePath);
    reopened.initialize();
    const second = new ToolCallRepository(storage, reopened);
    const records = await second.hydrate();
    assert.equal(second.hydrationSource, "journal");
    assert.deepEqual(
      new Set(records.map((record) => record.id)),
      new Set(["tool_a", "tool_b"]),
    );
    reopened.close();
  });

  it("falls back to the journal when the snapshot was never written", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-snapshot-"));
    roots.push(home);
    const storage = await initializeStorage(home);
    const path = join(home, "logs", "tool-calls.jsonl");
    await writeFile(path, JSON.stringify(toolCall("tool_a")) + "\n");
    const index = new IndexStore(storage.paths.sqlitePath);
    index.initialize();
    const repository = new ToolCallRepository(storage, index);
    const records = await repository.hydrate();
    assert.equal(repository.hydrationSource, "journal");
    assert.equal(records.length, 1);
    index.close();
  });

  it("refreshes the snapshot watermark on upsert", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-snapshot-"));
    roots.push(home);
    const storage = await initializeStorage(home);
    const path = join(home, "logs", "tool-calls.jsonl");
    await writeFile(path, JSON.stringify(toolCall("tool_a")) + "\n");
    const index = new IndexStore(storage.paths.sqlitePath);
    index.initialize();
    const repository = new ToolCallRepository(storage, index);
    await repository.hydrate();
    await repository.markToolCallSnapshotPersisted();
    await repository.upsert(toolCall("tool_b", "2026-07-25T00:00:03.000Z"));
    index.close();

    // The upsert refreshed the watermark, so a restart uses the snapshot.
    const reopened = new IndexStore(storage.paths.sqlitePath);
    reopened.initialize();
    const second = new ToolCallRepository(storage, reopened);
    const records = await second.hydrate();
    assert.equal(second.hydrationSource, "snapshot");
    assert.deepEqual(
      new Set(records.map((record) => record.id)),
      new Set(["tool_a", "tool_b"]),
    );
    reopened.close();
  });
});
