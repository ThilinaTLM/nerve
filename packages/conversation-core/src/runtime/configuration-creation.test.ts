import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ConversationCore } from "../core.js";
import { options, waitUntil } from "./lifecycle-test-helpers.js";

for (const fails of [false, true])
  void test(`creation persists scoped configuration before accepting work; failure=${fails}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-creation-config-"));
    let settle!: () => void;
    const gate = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const opts = options(
      directory,
      join(directory, "core.sqlite"),
      {
        resolve: async () => {
          throw new Error("No model expected");
        },
      },
      {
        execute: async () => {
          throw new Error("No tools expected");
        },
        isReplaySafe: () => false,
      },
    );
    let initialized = false;
    opts.configuration.initializeConversation = async ({ id }) => {
      assert.ok(
        opts.storage.conversations.get(id),
        "identity must exist before host persistence",
      );
      await gate;
      if (fails) throw new Error("Persistence failed");
      initialized = true;
    };
    const core = new ConversationCore(opts);
    core.projects.create({ id: "p", name: "Project", directory });
    try {
      const creating = core.createConversation({ id: "new", projectId: "p" });
      await waitUntil(() => Boolean(opts.storage.conversations.get("new")));
      assert.equal(initialized, false);
      assert.throws(
        () =>
          core.submitInput({
            conversationId: "new",
            inputId: "input",
            source: "user",
            text: "Too early",
          }),
        /still being initialized/,
      );
      settle();
      if (fails) {
        await assert.rejects(creating, /Persistence failed/);
        assert.equal(opts.storage.conversations.get("new"), null);
      } else {
        await creating;
        assert.equal(initialized, true);
        assert.equal(core.getSnapshot("new").conversation.id, "new");
      }
    } finally {
      settle();
      await core.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
