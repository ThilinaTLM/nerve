import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import type {
  AgentRecord,
  ApprovalRecord,
  ConversationRecord,
  ProjectRecord,
  TaskRecord,
  ToolCallRecord,
  UserQuestionRecord,
  WorkerRecord,
} from "@nervekit/contracts";
import { IndexStore } from "../src/infrastructure/index-store/index.js";

const roots: string[] = [];
const now = "2026-06-20T00:00:00.000Z";

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempDbPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-index-store-"));
  roots.push(root);
  return join(root, "state.sqlite");
}

describe("IndexStore", () => {
  it("bulk rebuilds repository-derived records", async () => {
    const path = await tempDbPath();
    const store = new IndexStore(path);
    store.initialize();

    store.upsertProject({
      id: "proj_stale",
      name: "stale",
      dir: "/tmp/stale",
      createdAt: now,
      updatedAt: now,
    });

    const project: ProjectRecord = {
      id: "proj_indexstore",
      name: "Index Store",
      dir: "/tmp/index-store",
      createdAt: now,
      updatedAt: now,
    };
    const conversation: ConversationRecord = {
      id: "conv_indexstore",
      projectId: project.id,
      title: "Conversation",
      mode: "coding",
      permissionLevel: "autonomous",
      activeAgentId: "agent_indexstore",
      createdAt: now,
      updatedAt: now,
    };
    const agent: AgentRecord = {
      id: "agent_indexstore",
      conversationId: conversation.id,
      projectId: project.id,
      projectDir: project.dir,
      rootAgentId: "agent_indexstore",
      mode: "coding",
      permissionLevel: "autonomous",
      workspaceScope: { roots: [project.dir] },
      budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
      thinkingLevel: "off",
      status: "idle",
      createdAt: now,
      updatedAt: now,
    };
    const task = {
      id: "task_indexstore",
      projectId: project.id,
      conversationId: conversation.id,
      agentId: agent.id,
      cwd: project.dir,
      command: "echo ready",
      status: "running",
      readiness: { outcome: "none" },
      stdoutPath: "/tmp/stdout",
      stderrPath: "/tmp/stderr",
      logsPath: "/tmp/logs",
      startedAt: now,
      updatedAt: now,
    } as TaskRecord;
    const worker: WorkerRecord = {
      id: "worker_indexstore",
      kind: "local",
      name: "local",
      status: "online",
      capabilities: ["agent", "task"],
      createdAt: now,
      updatedAt: now,
    };
    const toolCall = {
      id: "tool_indexstore",
      agentId: agent.id,
      conversationId: conversation.id,
      projectId: project.id,
      toolName: "read",
      risk: "read",
      args: { path: "README.md" },
      cwd: project.dir,
      status: "completed",
      createdAt: now,
      updatedAt: now,
    } as ToolCallRecord;
    const approval: ApprovalRecord = {
      id: "approval_indexstore",
      toolCallId: toolCall.id,
      agentId: agent.id,
      conversationId: conversation.id,
      projectId: project.id,
      risk: "read",
      reason: "test",
      status: "granted",
      requestedAt: now,
      resolvedAt: now,
    };
    const question: UserQuestionRecord = {
      id: "question_indexstore",
      toolCallId: toolCall.id,
      agentId: agent.id,
      conversationId: conversation.id,
      projectId: project.id,
      question: "Proceed?",
      status: "pending",
      requestedAt: now,
      updatedAt: now,
    };
    store.rebuild({
      projects: [project],
      conversations: [conversation],
      agents: [agent],
      tasks: [task],
      workers: [worker],
      toolCalls: [toolCall],
      approvals: [approval],
      userQuestions: [question],
    });
    assert.deepEqual(store.counts(), {
      projects: 1,
      conversations: 1,
      agents: 1,
      tasks: 1,
      workers: 1,
      userQuestions: 1,
    });
    store.close();

    const db = new DatabaseSync(path);
    try {
      const staleProject = db
        .prepare("SELECT id FROM projects WHERE id = ?")
        .get("proj_stale");
      assert.equal(staleProject, undefined);
      assert.equal(countTable(db, "tool_calls"), 1);
      assert.equal(countTable(db, "approvals"), 1);
    } finally {
      db.close();
    }
  });
});

function countTable(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
}
