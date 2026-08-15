import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { ToolCallRecord } from "@nervekit/contracts";
import {
  ToolCallRepository,
  ToolCallRevisionConflictError,
} from "../src/domains/tools/tool-call.repository.js";
import { IndexStore } from "../src/infrastructure/index-store/index.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

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
  const index = new IndexStore(storage.paths.sqlitePath);
  return { index, repository: new ToolCallRepository(storage, index) };
}

describe("canonical ToolCallRepository", () => {
  it("persists one file and hydrates it strictly", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-repository-"));
    roots.push(home);
    const first = await repository(home);
    await first.repository.create(toolCall("tool_test"));
    first.index.close();
    const second = await repository(home);
    await second.repository.hydrate();
    assert.equal(second.repository.get("tool_test").revision, 1);
    second.index.close();
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
    value.index.close();
  });
});
