import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";
import {
  type ConversationEntry,
  type ConversationRecord,
} from "@nervekit/contracts/conversations";
import { createId } from "@nervekit/contracts";
import { type TaskRecord } from "@nervekit/contracts/tasks";
import { TaskRepository } from "../../src/domains/tasks/persistence/task.repository.js";
import {
  createWorkbenchState,
  shutdownWorkbenchState,
  type WorkbenchState,
} from "../../src/app/runtime/server-runtime.js";
import { initializeStorage } from "../../src/infrastructure/storage-bootstrap/index.js";

const roots: string[] = [];
const states: WorkbenchState[] = [];

after(async () => {
  await Promise.allSettled(states.map(shutdownWorkbenchState));
  await Promise.all(
    roots.map((root) =>
      rm(root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      }),
    ),
  );
});

export async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

export async function createState(prefix = "nerve-registry-conversation-") {
  const storage = await initializeStorage(await tempHome(prefix));
  const state = createWorkbenchState(storage, "127.0.0.1", 0);
  states.push(state);
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
  state.queryCache.upsertConversation(aged);
  return aged;
}

export function appendRegistryEntry(
  state: Awaited<ReturnType<typeof createState>>,
  input: {
    id?: string;
    conversationId: string;
    parentEntryId?: string | null;
    role: ConversationEntry["role"];
    text: string;
    createdAt?: string;
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
  const logsPath = join(state.storage.paths.tasksPath, `${id}.logs.jsonl`);
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
    stdoutPath: logsPath,
    stderrPath: logsPath,
    combinedPath: logsPath,
    logsPath,
    startedAt: now,
    updatedAt: now,
  };
  state.registry.tasks.tasks.set(record.id, record);
  state.queryCache.upsertTask(record);
  await new TaskRepository(state.storage).write(record);
  return record;
}

export const oldConversationId = "conv_01HN0000000000000000000000";
export const oldAgentId = "agent_01HN0000000000000000000000";
export const firstEntryId = "entry_01HN0000000000000000000000";
export const secondEntryId = "entry_01HN0000000000000000000001";
export const createdAt = "2026-01-01T00:00:00.000Z";
