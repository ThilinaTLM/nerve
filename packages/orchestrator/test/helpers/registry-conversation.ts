import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import {
  type ConversationEntry,
  type ConversationRecord,
  createId,
  type TaskRecord,
} from "@nervekit/shared";
import { createOrchestratorState } from "../../src/app/orchestrator-state.js";
import { initializeStorage } from "../../src/infrastructure/storage/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

export async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

export async function createState(prefix = "nerve-registry-conversation-") {
  const storage = await initializeStorage(await tempHome(prefix));
  const state = createOrchestratorState(storage, "127.0.0.1", 0);
  await state.registry.hydrate();
  return state;
}

export function ageConversation(
  state: Awaited<ReturnType<typeof createState>>,
  conversation: ConversationRecord,
  updatedAt: string,
): ConversationRecord {
  const aged = { ...conversation, updatedAt };
  state.registry.conversations.set(conversation.id, aged);
  state.index.upsertConversation(aged);
  return aged;
}

export function appendRegistryEntry(
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

export async function addTaskRecord(
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

export const oldConversationId = "conv_01HN0000000000000000000000";
export const oldAgentId = "agent_01HN0000000000000000000000";
export const firstEntryId = "entry_01HN0000000000000000000000";
export const secondEntryId = "entry_01HN0000000000000000000001";
export const createdAt = "2026-01-01T00:00:00.000Z";
