import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationRepository } from "./conversation.repository.js";
import type { CoreDatabase } from "./database.js";
import { ConversationService } from "../conversations/conversation.service.js";

await test("SQL owns only working directory; prompt and agent mutations are rejected", () => {
  const statements: string[] = [];
  const row = {
    id: "conversation",
    working_directory: "/project",
  };
  const database = {
    sqlite: {
      prepare(sql: string) {
        statements.push(sql);
        return { get: () => row, run: () => {} };
      },
    },
  } as unknown as CoreDatabase;
  const repository = new ConversationRepository(database);
  const context = repository.getContext("conversation")!;
  assert.deepEqual(context, {
    conversationId: "conversation",
    workingDirectory: "/project",
  });
  repository.updateConfig("conversation", { workingDirectory: "/other" });
  assert.throws(() =>
    repository.updateConfig("conversation", {
      systemPrompt: "not SQL",
    } as never),
  );
  assert.throws(() =>
    repository.updateConfig("conversation", { reasoningLevel: "low" } as never),
  );
  assert(
    statements.every(
      (statement) =>
        !/\b(conversation_config|system_prompt|instructions|model|reasoning_level|permission_rule_set_id|mode|agent_profile)\b/.test(
          statement,
        ),
    ),
  );
});
await test("list SQL has no agent join", () => {
  const statements: string[] = [];
  const database = {
    sqlite: {
      prepare(sql: string) {
        statements.push(sql);
        return { all: () => [] };
      },
    },
  } as unknown as CoreDatabase;
  assert.deepEqual(
    new ConversationRepository(database).list({ projectId: "project" }),
    [],
  );
  assert(
    statements.every((statement) => !statement.includes("conversation_config")),
  );
});
await test("history snapshot keeps SQL working directory when JSON context is unavailable", () => {
  const context = {
    conversationId: "conversation",
    workingDirectory: "/project",
  };
  const service = new ConversationService({
    storage: {
      conversations: {
        get: () => ({ id: "conversation", projectId: "project" }),
        getContext: () => context,
        list: () => [],
      },
      events: { lastSequence: () => 3 },
      toolCalls: { list: () => [] },
      inputs: { list: () => [] },
      asyncBash: { list: () => [] },
    },
    compactions: { get: () => null },
  } as unknown as ConstructorParameters<typeof ConversationService>[0]);
  const snapshot = service.snapshot("conversation");
  assert.deepEqual(snapshot.config, context);
  assert.equal("model" in snapshot.config, false);
  assert.equal(snapshot.lastSequence, 3);
});
await test("configure awaits JSON context persistence and keeps working-directory-only history usable", async () => {
  let workingDirectory = "/project";
  let context: { instructions?: string | null; systemPrompt?: string | null } =
    {};
  let unavailable = false;
  const events: unknown[] = [];
  const service = new ConversationService({
    storage: {
      conversations: {
        getContext: () => ({ conversationId: "c", workingDirectory }),
        updateConfig: (_id: string, patch: { workingDirectory?: string }) => {
          if (patch.workingDirectory !== undefined)
            workingDirectory = patch.workingDirectory;
          return { conversationId: "c", workingDirectory };
        },
        getSummary: () => ({ id: "c" }),
        parentId: () => null,
      },
    },
    historyContext: () => (unavailable ? {} : context),
    async configureContext(_id: string, patch: typeof context) {
      if (unavailable) throw new Error("JSON unavailable");
      await Promise.resolve();
      context = { ...context, ...patch };
    },
    emit: (event: unknown) => events.push(event),
  } as unknown as ConstructorParameters<typeof ConversationService>[0]);
  const saved = await service.configure("c", {
    instructions: "local",
    systemPrompt: "custom",
    workingDirectory: "/new",
  });
  assert.deepEqual(saved, {
    conversationId: "c",
    workingDirectory: "/new",
    instructions: "local",
    systemPrompt: "custom",
  });
  assert.equal(events.length, 2);
  unavailable = true;
  await assert.rejects(
    service.configure("c", {
      instructions: "lost",
      workingDirectory: "/not-saved",
    }),
    /JSON unavailable/,
  );
  assert.equal(workingDirectory, "/new");
  assert.deepEqual(
    await service.configure("c", { workingDirectory: "/still-usable" }),
    { conversationId: "c", workingDirectory: "/still-usable" },
  );
});
