import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type ConversationRecord,
  createId,
  type ProcessRecord,
} from "@nerve/shared";
import { EntryRepository } from "../src/repositories/index.js";
import { createOrchestratorState } from "../src/server.js";
import {
  type InitializedStorage,
  initializeStorage,
  pathExists,
} from "../src/storage.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function createState(prefix = "nerve-registry-conversation-") {
  const storage = await initializeStorage(await tempHome(prefix));
  const state = createOrchestratorState(storage, "127.0.0.1", 0);
  await state.registry.hydrate();
  return state;
}

function ageConversation(
  state: Awaited<ReturnType<typeof createState>>,
  conversation: ConversationRecord,
  updatedAt: string,
): ConversationRecord {
  const aged = { ...conversation, updatedAt };
  state.registry.conversations.set(conversation.id, aged);
  state.index.upsertConversation(aged);
  return aged;
}

async function addProcessRecord(
  state: Awaited<ReturnType<typeof createState>>,
  input: {
    projectId: string;
    conversationId: string;
    agentId?: string;
    status: ProcessRecord["status"];
  },
): Promise<ProcessRecord> {
  const id = createId("proc");
  const dir = join(state.storage.paths.home, "proc", id);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const record: ProcessRecord = {
    id,
    projectId: input.projectId,
    conversationId: input.conversationId,
    agentId: input.agentId,
    cwd: state.storage.paths.home,
    command: "echo test",
    status: input.status,
    readiness: { outcome: "none" },
    stdoutPath: join(dir, "stdout.log"),
    stderrPath: join(dir, "stderr.log"),
    logsPath: join(dir, "logs.jsonl"),
    startedAt: now,
    updatedAt: now,
  };
  state.registry.processes.processes.set(record.id, record);
  state.index.upsertProcess(record);
  await writeFile(join(dir, "process.json"), `${JSON.stringify(record)}\n`);
  return record;
}

const oldConversationId = "conv_01HN0000000000000000000000";
const oldAgentId = "agent_01HN0000000000000000000000";
const firstEntryId = "entry_01HN0000000000000000000000";
const secondEntryId = "entry_01HN0000000000000000000001";
const createdAt = "2026-01-01T00:00:00.000Z";

describe("RuntimeRegistry conversation behavior", () => {
  it("creates projects, conversations, and agents through public APIs", async () => {
    const state = await createState();
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const agent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
      });

      assert.equal(state.registry.getProject(project.id).id, project.id);
      assert.equal(
        state.registry.getConversation(conversation.id).activeAgentId,
        agent.id,
      );
      assert.equal(
        state.registry.getAgent(agent.id).conversationId,
        conversation.id,
      );
    } finally {
      state.index.close();
    }
  });

  it("prunes old inactive project conversations and associated data", async () => {
    const state = await createState("nerve-registry-prune-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const oldConversation = await state.registry.createConversation({
        projectId: project.id,
        title: "Old Conversation",
      });
      const oldAgent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: oldConversation.id,
      });
      const recentConversation = await state.registry.createConversation({
        projectId: project.id,
        title: "Recent Conversation",
      });
      await state.registry.createAgent({
        projectId: project.id,
        conversationId: recentConversation.id,
      });
      ageConversation(state, oldConversation, "2000-01-01T00:00:00.000Z");
      ageConversation(state, recentConversation, new Date().toISOString());
      await state.registry.requestTool(oldAgent.id, "todos_set", {
        todos: [{ todo: "remove me", done: false }],
      });
      const inactiveProcess = await addProcessRecord(state, {
        projectId: project.id,
        conversationId: oldConversation.id,
        agentId: oldAgent.id,
        status: "exited",
      });

      const result = await state.registry.pruneProjectConversations(
        project.id,
        { olderThanDays: 7 },
      );

      assert.deepEqual(result.prunedConversationIds, [oldConversation.id]);
      assert.deepEqual(result.prunedProcessIds, [inactiveProcess.id]);
      assert.deepEqual(result.skipped, []);
      assert.throws(() => state.registry.getConversation(oldConversation.id));
      assert.equal(
        state.registry.getConversation(recentConversation.id).id,
        recentConversation.id,
      );
      assert.equal(
        await pathExists(
          join(state.storage.paths.home, "conversations", oldConversation.id),
        ),
        false,
      );
      assert.equal(
        await pathExists(
          join(state.storage.paths.home, "proc", inactiveProcess.id),
        ),
        false,
      );
      assert.equal(
        state.registry.tools
          .listToolCalls()
          .some((toolCall) => toolCall.conversationId === oldConversation.id),
        false,
      );
    } finally {
      state.index.close();
    }
  });

  it("skips old conversations with active agents or active processes", async () => {
    const state = await createState("nerve-registry-prune-skip-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const activeAgentConversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const activeAgent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: activeAgentConversation.id,
      });
      state.registry.agents.set(activeAgent.id, {
        ...activeAgent,
        status: "running",
      });
      const activeProcessConversation = await state.registry.createConversation(
        {
          projectId: project.id,
        },
      );
      const processAgent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: activeProcessConversation.id,
      });
      const activeProcess = await addProcessRecord(state, {
        projectId: project.id,
        conversationId: activeProcessConversation.id,
        agentId: processAgent.id,
        status: "running",
      });
      ageConversation(
        state,
        activeAgentConversation,
        "2000-01-01T00:00:00.000Z",
      );
      ageConversation(
        state,
        activeProcessConversation,
        "2000-01-01T00:00:00.000Z",
      );

      const result = await state.registry.pruneProjectConversations(
        project.id,
        { olderThanDays: 7 },
      );

      assert.deepEqual(result.prunedConversationIds, []);
      assert.deepEqual(result.prunedProcessIds, []);
      assert.deepEqual(result.skipped, [
        {
          conversationId: activeAgentConversation.id,
          reason: "active_agent",
        },
        {
          conversationId: activeProcessConversation.id,
          reason: "active_process",
        },
      ]);
      assert.equal(
        state.registry.getConversation(activeAgentConversation.id).id,
        activeAgentConversation.id,
      );
      assert.equal(
        state.registry.getConversation(activeProcessConversation.id).id,
        activeProcessConversation.id,
      );
      assert.equal(
        state.registry.processes.getProcess(activeProcess.id).id,
        activeProcess.id,
      );
    } finally {
      state.index.close();
    }
  });

  it("imports, navigates, exports, and remaps conversation entries", async () => {
    const state = await createState("nerve-registry-import-");
    try {
      const imported = await state.registry.importConversation({
        project: { dir: state.storage.paths.home, name: "Imported Project" },
        conversation: {
          title: "Imported Conversation",
          mode: "coding",
          permissionLevel: "supervised",
        },
        agents: [
          {
            id: oldAgentId,
            conversationId: oldConversationId,
            projectId: "proj_01HN0000000000000000000000",
            projectDir: state.storage.paths.home,
            rootAgentId: oldAgentId,
            mode: "coding",
            permissionLevel: "supervised",
            workspaceScope: { roots: [state.storage.paths.home] },
            budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
            status: "idle",
            createdAt,
            updatedAt: createdAt,
          },
        ],
        entries: [
          {
            id: firstEntryId,
            conversationId: oldConversationId,
            agentId: oldAgentId,
            role: "user",
            kind: "message",
            text: "Hello",
            createdAt,
          },
          {
            id: secondEntryId,
            conversationId: oldConversationId,
            agentId: oldAgentId,
            parentEntryId: firstEntryId,
            role: "assistant",
            kind: "message",
            text: "Hi there",
            createdAt,
          },
        ],
      });

      assert.equal(imported.entries.length, 2);
      assert.notEqual(imported.conversation.id, oldConversationId);
      assert.notEqual(imported.agents[0]?.id, oldAgentId);
      assert.notEqual(imported.entries[0]?.id, firstEntryId);
      assert.equal(imported.entries[1]?.parentEntryId, imported.entries[0]?.id);
      assert.equal(
        imported.conversation.activeEntryId,
        imported.entries[1]?.id,
      );

      await state.registry.navigateConversation(imported.conversation.id, {
        activeEntryId: imported.entries[0]?.id ?? null,
      });
      assert.deepEqual(
        state.registry
          .getConversationEntries(imported.conversation.id)
          .map((entry) => entry.text),
        ["Hello"],
      );

      const exported = state.registry.exportConversation(
        imported.conversation.id,
      );
      assert.equal(exported.entries.length, 2);
      assert.equal(exported.entries[1]?.parentEntryId, exported.entries[0]?.id);
    } finally {
      state.index.close();
    }
  });

  it("repairs display parents that point at skipped harness metadata entries", () => {
    const repository = new EntryRepository({} as InitializedStorage);
    const conversation = {
      id: "conv_01HN0000000000000000000001",
      projectId: "proj_01HN0000000000000000000001",
      title: "Missing metadata parent",
      mode: "coding",
      permissionLevel: "autonomous",
      activeEntryId: "entry_01HN0000000000000000000005",
      createdAt,
      updatedAt: createdAt,
    } as const;
    const entries = [
      {
        id: "entry_01HN0000000000000000000002",
        conversationId: conversation.id,
        role: "user",
        kind: "message",
        text: "Start",
        createdAt,
      },
      {
        id: "entry_01HN0000000000000000000003",
        conversationId: conversation.id,
        parentEntryId: "entry_01HN0000000000000000000002",
        role: "system",
        kind: "message",
        text: "Plan accepted",
        createdAt,
      },
      {
        id: "entry_01HN0000000000000000000005",
        conversationId: conversation.id,
        parentEntryId: "entry_01HN0000000000000000000004",
        role: "assistant",
        kind: "message",
        text: "Continue after active tools change",
        createdAt,
      },
    ] as const;
    const entriesByConversationId = new Map([[conversation.id, [...entries]]]);

    assert.deepEqual(
      repository
        .activeBranchEntries(entriesByConversationId, conversation)
        .map((entry) => entry.text),
      ["Start", "Plan accepted", "Continue after active tools change"],
    );

    const tree = repository.getConversationTree(
      entriesByConversationId,
      conversation,
    );
    const ids = new Set(tree.nodes.map((node) => node.entry.id));
    assert.equal(
      tree.nodes.every(
        (node) =>
          !node.entry.parentEntryId || ids.has(node.entry.parentEntryId),
      ),
      true,
    );
    assert.equal(
      tree.nodes.find((node) => node.entry.id === conversation.activeEntryId)
        ?.entry.parentEntryId,
      "entry_01HN0000000000000000000003",
    );
  });
});
