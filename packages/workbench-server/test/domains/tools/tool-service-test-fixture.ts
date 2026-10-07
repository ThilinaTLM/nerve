import type { AgentRecord } from "@nervekit/contracts/agents";
import { defaultSettings } from "@nervekit/contracts/settings";
import { ToolService } from "../../../src/domains/tools/execution/tool-service.js";
import { ToolResultPayloadStore } from "../../../src/domains/tools/artifacts/tool-result-payload-store.js";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { ToolCallRepository } from "../../../src/domains/tools/artifacts/tool-call.repository.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";

export function buildToolService(
  home: string,
  testAgent: AgentRecord,
  publisher?: { publish(type: string, data: unknown): Promise<unknown> },
  pythonRuntime?: {
    runtimeForProject(projectDir: string): Promise<undefined>;
  },
  logger?: {
    info(message: string, context: unknown): Promise<void>;
    warn(message: string, context: unknown): Promise<void>;
  },
  liveAgent?: () => AgentRecord,
) {
  const events: Array<{ type: string; data: unknown }> = [];
  const storage = {
    paths: storagePaths(home),
    settings: defaultSettings,
    localToken: "test",
  };
  const journal = new ConversationJournalRepository(storage);
  const resultPayloads = new ToolResultPayloadStore(home);
  const service = new ToolService({
    events: (publisher ?? {
      publish: async (type: string, data: unknown) =>
        events.push({ type, data }),
    }) as never,
    tasks: {} as never,
    pythonRuntime: (pythonRuntime ?? {
      runtimeForProject: async () => undefined,
      isAvailableForProject: async () => false,
      statusSnapshot: () => ({
        available: false,
        source: "unavailable",
        error: "not used",
      }),
      refresh: async () => ({
        available: false,
        source: "unavailable",
        error: "not used",
      }),
    }) as never,
    startTask: async () => {
      throw new Error("not used");
    },
    getAgent: liveAgent ?? (() => testAgent),
    runExplore: async () => {
      throw new Error("not used");
    },
    getApiKey: async () => undefined,
    resolveToolScope: async () => {
      throw new Error("Integrations are not used by this test.");
    },
    explainImage: {} as never,
    generateImage: {} as never,
    storage,
    plans: {
      resetToolCallHydration: () => {},
      hydrateFromToolCall: () => {},
    } as never,
    setAgentMode: async () => testAgent,
    conversationRuntime: {} as never,
    logger: logger as never,
    journal,
    resultPayloads,
    toolCallRepository: new ToolCallRepository(journal, resultPayloads),
  });
  const journalCommit = async (
    next: { conversationId: string },
    journalEvents: import("@nervekit/contracts/conversations").ConversationJournalEvent[],
  ) => {
    await journal.commit(next.conversationId, {
      kind: "tool_call.revised",
      events: journalEvents,
    });
  };
  return { service, events, journalCommit, journal };
}

export function agent(
  permissionLevel: AgentRecord["permissionLevel"],
): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "coding",
    permissionLevel,
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3 },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
