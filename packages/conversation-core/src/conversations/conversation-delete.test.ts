import { randomUUID } from "node:crypto";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConversationCore } from "../core.js";
import {
  options,
  createConversation,
} from "../runtime/lifecycle-test-helpers.js";

for (const fault of ["payload", "status"] as const) {
  void test(`raw deletion removes a corrupt ${fault}, descendants, malformed work and files, but not siblings`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "conv-resilience-delete-"));
    const database = join(directory, "core.sqlite");
    const unexpected = async (): Promise<never> => {
      throw new Error("No execution expected");
    };
    const opts = options(
      directory,
      database,
      { resolve: unexpected },
      { execute: unexpected, isReplaySafe: () => false },
    );
    const core = new ConversationCore(opts);
    try {
      await core.start();
      await createConversation(core, "bad");
      await createConversation(core, "healthy");
      await core.createConversation({
        id: "child",
        projectId: "proj_test",
        parentConversationId: "bad",
      });
      for (const id of ["bad", "child", "healthy"]) {
        const folder = join(directory, "conversations", id, "config");
        await mkdir(folder, { recursive: true });
        await writeFile(join(folder, "agent.json"), "{");
      }
      opts.storage.events.append({
        id: "evt_bad",
        conversationId: "bad",
        previousEventId: null,
        turnId: null,
        inputId: null,
        createdAt: new Date().toISOString(),
        type: "user_message",
        llmRepresentation: "user",
        payload: {
          text: "probe",
          originalText: "probe",
          source: "user",
          senderConversationId: null,
          commandPreparation: null,
        },
      });
      opts.storage.inputs.insert({
        inputId: "queued",
        conversationId: "child",
        source: "user",
        senderConversationId: null,
        content: "probe",
        deliveryTarget: "next_turn",
        targetExecutionId: null,
        commandPreparation: null,
        preparedText: null,
        wakeWhenIdle: true,
        acceptedAt: new Date().toISOString(),
      });
      opts.storage.toolCalls.insert({
        id: "tool",
        conversationId: "child",
        turnId: "turn",
        providerCallId: null,
        assistantEventId: null,
        contentIndex: null,
        origin: "user",
        toolName: "bash",
        arguments: {},
        state: "ready",
        supervision: null,
        interaction: null,
        executionClaim: null,
        updatedAt: new Date().toISOString(),
      });
      const db = new DatabaseSync(database);
      db.exec(
        "PRAGMA ignore_check_constraints=ON; UPDATE input_queue SET content='{' WHERE input_id='queued'; UPDATE tool_call SET arguments='{' WHERE id='tool'",
      );
      if (fault === "status")
        db.exec(
          "UPDATE conversation SET status='broken' WHERE id IN ('bad','child')",
        );
      else
        db.exec(
          "UPDATE conversation_event SET payload='{' WHERE conversation_id='bad'",
        );
      db.close();
      await core.delete("bad");
      await core.delete("bad");
      assert.equal(opts.storage.conversations.rawIdentity("bad"), null);
      assert.equal(opts.storage.conversations.rawIdentity("child"), null);
      assert.ok(opts.storage.conversations.get("healthy"));
      assert.deepEqual(opts.storage.inputs.ids("child"), []);
      assert.deepEqual(opts.storage.toolCalls.ids("child"), []);
      await assert.rejects(access(join(directory, "conversations", "bad")));
      await assert.rejects(access(join(directory, "conversations", "child")));
      await access(
        join(directory, "conversations", "healthy", "config", "agent.json"),
      );
      const reopened = new DatabaseSync(database, { readOnly: true });
      assert.equal(
        reopened
          .prepare(
            "SELECT count(*) AS n FROM conversation WHERE id IN ('bad','child')",
          )
          .get()?.n,
        0,
      );
      reopened.close();
    } finally {
      await core.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

void test(
  "raw deletion fences and aborts an active worker before removing its files",
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "conv-resilience-active-delete-"),
    );
    const database = join(directory, "core.sqlite");
    const provider = registerAgentScriptedProvider({
      provider: `delete-${randomUUID()}`,
      model: "test",
      steps: [
        {
          type: "toolCalls",
          calls: [{ id: "call", name: "bash", args: { command: "wait" } }],
        },
        { type: "waitForAbort" },
      ],
    });
    let started!: (signal: AbortSignal) => void;
    const running = new Promise<AbortSignal>((resolve) => {
      started = resolve;
    });
    const opts = options(
      directory,
      database,
      { resolve: async () => ({ model: provider.getModel("test")! }) },
      {
        execute: async ({ signal }) => {
          started(signal);
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          return {
            kind: "completed",
            result: { content: "late result must not persist" },
          };
        },
        isReplaySafe: () => false,
      },
    );
    const core = new ConversationCore(opts);
    try {
      await core.start();
      await createConversation(core, "active");
      core.submitInput({
        conversationId: "active",
        inputId: "input_active",
        source: "user",
        text: "Use the tool",
      });
      const signal = await running;
      const db = new DatabaseSync(database);
      db.exec(
        "PRAGMA ignore_check_constraints=ON; UPDATE conversation SET status='broken' WHERE id='active'",
      );
      db.close();
      await core.delete("active");
      assert.equal(signal.aborted, true);
      assert.equal(opts.storage.conversations.rawIdentity("active"), null);
      assert.deepEqual(opts.storage.events.since("active", 0), []);
      await assert.rejects(access(join(directory, "conversations", "active")));
    } finally {
      await core.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
