import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
