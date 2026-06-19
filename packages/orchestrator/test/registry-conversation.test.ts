import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type ConversationEntry,
  type ConversationRecord,
  createId,
  type TaskRecord,
} from "@nerve/shared";
import { EntryRepository } from "../src/domains/conversations/index.js";
import {
  type InitializedStorage,
  initializeStorage,
  pathExists,
  writeSettings,
} from "../src/infrastructure/storage/index.js";
import { createOrchestratorState } from "../src/server.js";

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

function appendRegistryEntry(
  state: Awaited<ReturnType<typeof createState>>,
  input: {
    conversationId: string;
    parentEntryId?: string | null;
    role: ConversationEntry["role"];
    text: string;
  },
): Promise<ConversationEntry> {
  return (
    state.registry as unknown as {
      appendEntry: (input: typeof input) => Promise<ConversationEntry>;
    }
  ).appendEntry(input);
}

async function addTaskRecord(
  state: Awaited<ReturnType<typeof createState>>,
  input: {
    projectId: string;
    conversationId: string;
    agentId?: string;
    status: TaskRecord["status"];
  },
): Promise<TaskRecord> {
  const id = createId("task");
  const dir = join(state.storage.paths.home, "tasks", id);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const record: TaskRecord = {
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
  state.registry.tasks.tasks.set(record.id, record);
  state.index.upsertTask(record);
  await writeFile(join(dir, "task.json"), `${JSON.stringify(record)}\n`);
  return record;
}

const oldConversationId = "conv_01HN0000000000000000000000";
const oldAgentId = "agent_01HN0000000000000000000000";
const firstEntryId = "entry_01HN0000000000000000000000";
const secondEntryId = "entry_01HN0000000000000000000001";
const createdAt = "2026-01-01T00:00:00.000Z";

describe("RuntimeRegistry conversation behavior", () => {
  it("expands legacy auto-truncated conversation titles on hydrate", async () => {
    const storage = await initializeStorage(
      await tempHome("nerve-registry-title-repair-"),
    );
    const conversationDir = join(
      storage.paths.home,
      "conversations",
      oldConversationId,
    );
    await mkdir(conversationDir, { recursive: true });
    const text =
      "Build a focused onboarding screen that explains projects, conversations, agents, and local tool permissions without overwhelming first-time users.";
    const conversation: ConversationRecord = {
      id: oldConversationId,
      projectId: "proj_01HN0000000000000000000000",
      title: "Build a focused onboarding screen that explains projects…",
      mode: "coding",
      permissionLevel: "autonomous",
      activeEntryId: firstEntryId,
      createdAt,
      updatedAt: createdAt,
    };
    const entry: ConversationEntry = {
      id: firstEntryId,
      conversationId: oldConversationId,
      role: "user",
      kind: "message",
      text,
      createdAt,
    };
    await writeFile(
      join(conversationDir, "conversation.json"),
      `${JSON.stringify(conversation)}\n`,
    );
    await writeFile(
      join(conversationDir, "entries.jsonl"),
      `${JSON.stringify(entry)}\n`,
    );

    const state = createOrchestratorState(storage, "127.0.0.1", 0);
    await state.registry.hydrate();

    const repaired = state.registry.getConversation(oldConversationId);
    assert.equal(repaired.title, text);
    assert.equal(repaired.updatedAt, createdAt);

    const persisted = JSON.parse(
      await readFile(join(conversationDir, "conversation.json"), "utf8"),
    ) as ConversationRecord;
    assert.equal(persisted.title, text);
    assert.equal(persisted.updatedAt, createdAt);
  });

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

  it("publishes compaction lifecycle events with metadata", async () => {
    const state = await createState("nerve-registry-compaction-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const first = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Please inspect this project.",
      });
      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        parentEntryId: first.id,
        role: "assistant",
        text: "I inspected it and found several files.",
      });
      await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "Now summarize the work.",
      });

      const result = await state.registry.compactConversation(conversation.id);
      const events = state.events.replaySince(0);
      const started = events.find(
        (event) => event.type === "conversation.compaction.started",
      );
      const compacted = events.find(
        (event) => event.type === "conversation.compacted",
      );

      assert.ok(started);
      assert.equal((started.data as { reason?: string }).reason, "manual");
      assert.ok(compacted);
      assert.equal((compacted.data as { reason?: string }).reason, "manual");
      assert.equal(result.entry.kind, "compaction");
      assert.equal(
        (result.entry.details as { reason?: string }).reason,
        "manual",
      );
      assert.equal(
        (result.entry.details as { generatedBy?: string }).generatedBy,
        "orchestrator-extractive",
      );
    } finally {
      state.index.close();
    }
  });

  it("writes and clears new agent default model settings", async () => {
    const state = await createState("nerve-registry-settings-merge-");
    try {
      const first = await writeSettings(state.storage, {
        defaultModel: { provider: "nerve-faux", modelId: "faux-fast" },
        defaultThinkingLevel: "high",
        lastAgentSelection: {
          model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
          thinkingLevel: "medium",
          mode: "planning",
        },
      });
      assert.deepEqual(first.defaultModel, {
        provider: "nerve-faux",
        modelId: "faux-fast",
      });
      assert.equal(first.defaultThinkingLevel, "high");
      assert.deepEqual(first.lastAgentSelection.model, {
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
      });
      assert.equal(first.lastAgentSelection.permissionLevel, "autonomous");

      const second = await writeSettings(state.storage, {
        defaultModel: null,
        lastAgentSelection: { model: null, permissionLevel: "read_only" },
      });
      assert.equal(second.defaultModel, undefined);
      assert.equal(second.lastAgentSelection.model, undefined);
      assert.equal(second.lastAgentSelection.mode, "planning");
      assert.equal(second.lastAgentSelection.permissionLevel, "read_only");
    } finally {
      state.index.close();
    }
  });

  it("applies configured defaults to new root conversations and agents", async () => {
    const state = await createState("nerve-registry-agent-defaults-");
    try {
      await writeSettings(state.storage, {
        defaultMode: "planning",
        defaultPermissionLevel: "supervised",
        defaultModel: { provider: "nerve-faux", modelId: "faux-fast" },
        defaultThinkingLevel: "off",
      });
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

      assert.equal(conversation.mode, "planning");
      assert.equal(conversation.permissionLevel, "supervised");
      assert.deepEqual(agent.model, {
        provider: "nerve-faux",
        modelId: "faux-fast",
      });
      assert.equal(agent.thinkingLevel, "off");
    } finally {
      state.index.close();
    }
  });

  it("uses remembered last selection for new root conversations and agents", async () => {
    const state = await createState("nerve-registry-agent-last-");
    try {
      await writeSettings(state.storage, {
        rememberLastAgentSelection: true,
        lastAgentSelection: {
          mode: "planning",
          permissionLevel: "read_only",
          model: { provider: "nerve-faux", modelId: "faux-fast" },
          thinkingLevel: "off",
        },
      });
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

      assert.equal(conversation.mode, "planning");
      assert.equal(conversation.permissionLevel, "read_only");
      assert.deepEqual(agent.model, {
        provider: "nerve-faux",
        modelId: "faux-fast",
      });
      assert.equal(agent.thinkingLevel, "off");
    } finally {
      state.index.close();
    }
  });

  it("lets explicit root agent creation values override settings defaults", async () => {
    const state = await createState("nerve-registry-agent-explicit-");
    try {
      await writeSettings(state.storage, {
        rememberLastAgentSelection: true,
        lastAgentSelection: {
          mode: "planning",
          permissionLevel: "read_only",
          model: { provider: "anthropic", modelId: "claude-sonnet-4-5" },
          thinkingLevel: "high",
        },
      });
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
        mode: "coding",
        permissionLevel: "autonomous",
      });
      const agent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: conversation.id,
        model: { provider: "nerve-faux", modelId: "faux-fast" },
        thinkingLevel: "off",
        mode: "coding",
        permissionLevel: "supervised",
      });

      assert.equal(conversation.mode, "coding");
      assert.equal(conversation.permissionLevel, "autonomous");
      assert.equal(agent.mode, "coding");
      assert.equal(agent.permissionLevel, "supervised");
      assert.deepEqual(agent.model, {
        provider: "nerve-faux",
        modelId: "faux-fast",
      });
      assert.equal(agent.thinkingLevel, "off");
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
      const inactiveTask = await addTaskRecord(state, {
        projectId: project.id,
        conversationId: oldConversation.id,
        agentId: oldAgent.id,
        status: "exited",
      });

      const result = await state.registry.pruneProjectConversations(
        project.id,
        { strategy: "olderThanDays", olderThanDays: 7 },
      );

      assert.equal(result.strategy, "olderThanDays");
      assert.deepEqual(result.prunedConversationIds, [oldConversation.id]);
      assert.deepEqual(result.prunedTaskIds, [inactiveTask.id]);
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
          join(state.storage.paths.home, "tasks", inactiveTask.id),
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

  it("skips old conversations with active agents or active tasks", async () => {
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
      const activeTaskConversation = await state.registry.createConversation({
        projectId: project.id,
      });
      const taskAgent = await state.registry.createAgent({
        projectId: project.id,
        conversationId: activeTaskConversation.id,
      });
      const activeTask = await addTaskRecord(state, {
        projectId: project.id,
        conversationId: activeTaskConversation.id,
        agentId: taskAgent.id,
        status: "running",
      });
      ageConversation(
        state,
        activeAgentConversation,
        "2000-01-01T00:00:00.000Z",
      );
      ageConversation(
        state,
        activeTaskConversation,
        "2000-01-01T00:00:00.000Z",
      );

      const result = await state.registry.pruneProjectConversations(
        project.id,
        { strategy: "olderThanDays", olderThanDays: 7 },
      );

      assert.deepEqual(result.prunedConversationIds, []);
      assert.deepEqual(result.prunedTaskIds, []);
      assert.deepEqual(result.skipped, [
        {
          conversationId: activeAgentConversation.id,
          reason: "active_agent",
        },
        {
          conversationId: activeTaskConversation.id,
          reason: "active_task",
        },
      ]);
      assert.equal(
        state.registry.getConversation(activeAgentConversation.id).id,
        activeAgentConversation.id,
      );
      assert.equal(
        state.registry.getConversation(activeTaskConversation.id).id,
        activeTaskConversation.id,
      );
      assert.equal(
        state.registry.tasks.getTask(activeTask.id).id,
        activeTask.id,
      );
    } finally {
      state.index.close();
    }
  });

  it("keeps the most recent conversations when pruning by count", async () => {
    const state = await createState("nerve-registry-prune-keep-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const oldest = await state.registry.createConversation({
        projectId: project.id,
        title: "Oldest",
      });
      const middle = await state.registry.createConversation({
        projectId: project.id,
        title: "Middle",
      });
      const newest = await state.registry.createConversation({
        projectId: project.id,
        title: "Newest",
      });
      ageConversation(state, oldest, "2020-01-01T00:00:00.000Z");
      ageConversation(state, middle, "2020-06-01T00:00:00.000Z");
      ageConversation(state, newest, "2021-01-01T00:00:00.000Z");

      const result = await state.registry.pruneProjectConversations(
        project.id,
        { strategy: "keepLatest", keepLatest: 1 },
      );

      assert.equal(result.strategy, "keepLatest");
      assert.deepEqual(
        result.prunedConversationIds.sort(),
        [middle.id, oldest.id].sort(),
      );
      assert.deepEqual(result.skipped, []);
      assert.equal(state.registry.getConversation(newest.id).id, newest.id);
      assert.throws(() => state.registry.getConversation(oldest.id));
      assert.throws(() => state.registry.getConversation(middle.id));
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

  it("projects the active branch after forking from the middle", async () => {
    const state = await createState("nerve-registry-branch-projection-");
    try {
      const project = await state.registry.createProject({
        dir: state.storage.paths.home,
      });
      const conversation = await state.registry.createConversation({
        projectId: project.id,
        title: "Branch projection",
      });

      const first = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "A",
      });
      const second = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "assistant",
        text: "B",
      });
      const abandoned = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "C",
      });

      await state.registry.navigateConversation(conversation.id, {
        activeEntryId: second.id,
      });
      const forked = await appendRegistryEntry(state, {
        conversationId: conversation.id,
        role: "user",
        text: "D",
      });

      assert.deepEqual(
        state.registry
          .getConversationEntries(conversation.id)
          .map((entry) => entry.text),
        ["A", "B", "D"],
      );
      assert.deepEqual(
        await state.registry
          .getConversationSnapshot(conversation.id)
          .then((snapshot) => snapshot.activeEntryIds),
        [first.id, second.id, forked.id],
      );

      const tree = state.registry.getConversationTree(conversation.id);
      assert.deepEqual(
        tree.nodes.find((node) => node.entry.id === second.id)?.childEntryIds,
        [abandoned.id, forked.id],
      );

      await state.registry.navigateConversation(conversation.id, {
        activeEntryId: null,
      });
      assert.deepEqual(
        state.registry.getConversationEntries(conversation.id),
        [],
      );
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
