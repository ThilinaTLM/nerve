import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import {
  ToolCallRepository,
  ToolCallRevisionConflictError,
} from "../../../src/domains/tools/artifacts/tool-call.repository.js";
import { RuntimeQueryCache } from "../../../src/infrastructure/persistence/query-cache/index.js";
import { ToolResultPayloadStore } from "../../../src/domains/tools/artifacts/tool-result-payload-store.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

function toolCall(id: string): ToolCallRecord {
  const now = "2026-07-25T00:00:00.000Z";
  return {
    id,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName: "read",
    risk: "read",
    args: { path: "README.md" },
    cwd: "/tmp/project",
    status: "running",
    revision: 1,
    attempt: 1,
    interactions: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function repository(home: string) {
  const storage = await initializeStorage(home);
  const queryCache = new RuntimeQueryCache(storage.paths.sqlitePath);
  const payloads = new ToolResultPayloadStore(home);
  return {
    queryCache,
    payloads,
    repository: new ToolCallRepository(storage, queryCache, payloads),
  };
}

describe("canonical ToolCallRepository", () => {
  it("persists one file and hydrates it strictly", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-repository-"));
    roots.push(home);
    const first = await repository(home);
    await first.repository.create(toolCall("tool_test"));
    first.queryCache.close();
    const second = await repository(home);
    await second.repository.hydrate();
    assert.equal(second.repository.get("tool_test").revision, 1);
    second.queryCache.close();
  });

  it("serializes CAS updates, rejects stale revisions, and freezes terminal records", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-repository-"));
    roots.push(home);
    const value = await repository(home);
    await value.repository.create(toolCall("tool_test"));
    const completed = await value.repository.replace(
      "tool_test",
      1,
      (current) => ({
        ...current,
        status: "completed",
        result: "ok",
        settledAt: current.updatedAt,
      }),
    );
    assert.equal(completed.revision, 2);
    await assert.rejects(
      value.repository.replace("tool_test", 1, (current) => current),
      ToolCallRevisionConflictError,
    );
    await assert.rejects(
      value.repository.replace("tool_test", 2, (current) => current),
      /immutable/,
    );
    value.queryCache.close();
  });

  it("hydrates terminal history into previews without retaining full records", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-repository-"));
    roots.push(home);
    const first = await repository(home);
    for (let queryCache = 0; queryCache < 50; queryCache += 1) {
      await first.repository.create({
        ...toolCall(`tool_terminal_${queryCache}`),
        status: "completed",
        result: { content: "x".repeat(64 * 1024) },
        settledAt: "2026-07-25T00:00:00.000Z",
      });
    }
    await first.repository.create(toolCall("tool_active"));
    first.queryCache.close();

    const second = await repository(home);
    await second.repository.hydrate();

    assert.deepEqual(second.repository.residentStats(), {
      activeRecords: 1,
      cachedTerminalRecords: 0,
      cachedTerminalBytes: 0,
    });
    assert.equal(second.repository.count(), 51);
    assert.equal(second.repository.listPreviews({ limit: 100 }).length, 51);
    assert.throws(() => second.repository.get("tool_terminal_0"), /not active/);
    assert.equal(
      (await second.repository.getCanonical("tool_terminal_0")).status,
      "completed",
    );
    assert.equal(second.repository.residentStats().cachedTerminalRecords, 1);
    second.queryCache.close();
  });

  it("loads complete details explicitly without hydrating transcript history", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-repository-"));
    roots.push(home);
    const value = await repository(home);
    const resultPayload = await value.payloads.write(
      "conv_test",
      "tool_payload",
      { content: "complete output" },
    );
    await value.repository.create({
      ...toolCall("tool_payload"),
      status: "completed",
      result: { content: "bounded" },
      resultPreview: { content: "bounded" },
      resultPayload,
      settledAt: "2026-07-25T00:00:00.000Z",
    });

    const details = await value.repository.getDetails("tool_payload");
    assert.equal(details.completeResult.status, "payload");
    assert.equal(details.completeResult.byteLength, resultPayload.byteLength);
    const chunk = await value.repository.readResult(
      "tool_payload",
      0,
      64 * 1024,
    );
    assert.equal(chunk.status, "payload");
    assert.match(chunk.text, /complete output/);
    assert.equal(chunk.done, true);
    assert.deepEqual(
      value.repository.listPreviews({ limit: 10 })[0]?.resultPreview,
      { content: "bounded" },
    );
    value.queryCache.close();
  });

  it("pages previews stably by updated time and id", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-repository-"));
    roots.push(home);
    const value = await repository(home);
    for (let queryCache = 0; queryCache < 5; queryCache += 1) {
      await value.repository.create({
        ...toolCall(`tool_page_${queryCache}`),
        status: "completed",
        result: "ok",
        settledAt: "2026-07-25T00:00:00.000Z",
      });
    }
    const first = value.repository.queryPreviews({ limit: 2 });
    assert.equal(first.toolCalls.length, 2);
    assert.ok(first.nextCursor);
    const second = value.repository.queryPreviews({
      limit: 2,
      cursor: first.nextCursor,
    });
    assert.equal(second.toolCalls.length, 2);
    assert.equal(
      new Set([...first.toolCalls, ...second.toolCalls].map((call) => call.id))
        .size,
      4,
    );
    assert.ok(second.nextCursor);
    const third = value.repository.queryPreviews({
      limit: 2,
      cursor: second.nextCursor,
    });
    assert.equal(third.toolCalls.length, 1);
    assert.equal(third.nextCursor, undefined);
    value.queryCache.close();
  });
});
