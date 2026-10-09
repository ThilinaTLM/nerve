import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import {
  decode,
  encode,
} from "../../../src/infrastructure/persistence/canonical-sqlite/payload-codecs.js";
import type { SerializedConversationState } from "../../../src/domains/conversations/conversation-state-materializer.js";
import { ConversationJournalRepository } from "../../../src/domains/conversations/conversation-journal.repository.js";
import { ConversationRepository } from "../../../src/domains/conversations/conversation.repository.js";
import { ConversationHarnessStorage } from "../../../src/domains/conversations/conversation-harness-storage.js";
import { ConversationService } from "../../../src/domains/conversations/conversation-service.js";
import { ModelHistoryInvalidError } from "../../../src/domains/conversations/model-history-navigation.js";
import { AgentInputRepository } from "../../../src/domains/runs/persistence/agent-input.repository.js";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";

function corruptFixtureModelTree(
  path: string,
  conversationId: string,
  corruption: "missing-parent" | "cycle",
) {
  const database = new DatabaseSync(path);
  try {
    const row = database
      .prepare(
        "SELECT data FROM domain_documents WHERE namespace = 'conversation_state' AND scope_id = ? AND document_id = 'state'",
      )
      .get(conversationId) as { data: Uint8Array } | undefined;
    assert.ok(row);
    const state = decode(row.data) as SerializedConversationState;
    state.modelEntries = [
      {
        type: "message",
        id: "entry_malformed_owner",
        parentId:
          corruption === "cycle"
            ? "entry_malformed_owner"
            : "entry_missing_parent",
        timestamp: "2026-10-09T00:00:00.000Z",
        message: {
          role: "user",
          content: "historical malformed model tree",
          timestamp: 1,
        },
      },
    ];
    state.modelLeafId = "entry_malformed_owner";
    database
      .prepare(
        "UPDATE domain_documents SET data = ? WHERE namespace = 'conversation_state' AND scope_id = ? AND document_id = 'state'",
      )
      .run(encode(state), conversationId);
  } finally {
    database.close();
  }
}

for (const corruption of ["missing-parent", "cycle"] as const) {
  for (const inline of [false, true]) {
    test(`cold persisted ${corruption} constructor blocks ${inline ? "inline shell" : "provider"} preparation without cache fallback/replay`, async (t) => {
      const home = await mkdtemp(join(tmpdir(), "nerve-model-construction-"));
      const output = join(home, "MUST_NOT_EXECUTE");
      const prompt = inline
        ? `!touch '${output}'`
        : "ACCEPTED_UNDISPATCHED_PROMPT";
      const providerId = `nerve-model-construction-${corruption}-${inline}`;
      const provider = registerAgentScriptedProvider({
        provider: providerId,
        steps: [],
      });
      let requests = 0;
      provider.setResponses(
        Array.from({ length: 5 }, () => () => {
          requests++;
          return fauxAssistantMessage("must not dispatch");
        }),
      );
      const storage = await initializeStorage(home);
      const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
      let coldJournal: ConversationJournalRepository | undefined;
      try {
        await runtime.lifecycle.hydrate();
        const project = await runtime.services.projectLifecycle.createProject({
          dir: home,
        });
        const conversation =
          await runtime.services.conversationLifecycle.createConversation({
            projectId: project.id,
          });
        const agent = await runtime.services.agentLifecycle.createAgent({
          projectId: project.id,
          conversationId: conversation.id,
          model: { provider: providerId, modelId: "scripted-fast" },
        });
        await runtime.services.conversationJournal.load(conversation.id);
        await runtime.services.conversationJournal.checkpointLoaded();
        // Raw corruption is confined to this disposable SQLite fixture. Keep the
        // admission journal resident, and force the model-read seam through a
        // separate cold repository so the actual constructor fails before the
        // path validator. This isolates preparation from journal admission errors.
        corruptFixtureModelTree(
          storage.paths.sqlitePath,
          conversation.id,
          corruption,
        );
        coldJournal = new ConversationJournalRepository(storage);
        const coldStorage = new ConversationHarnessStorage(
          new ConversationRepository(coldJournal),
          (id) => runtime.services.conversationLifecycle.getConversation(id),
        );
        let fallbacks = 0;
        const cache = new ConversationService(coldStorage, {
          activeBranchEntries: () => {
            fallbacks++;
            return [];
          },
        } as unknown as ConstructorParameters<typeof ConversationService>[1]);
        cache.setForAgent(agent.id, [
          { role: "user", content: "STALE_CONTEXT", timestamp: 0 },
        ]);
        await assert.rejects(
          cache.rebuildConversation(project, conversation, [agent], []),
          ModelHistoryInvalidError,
        );
        assert.equal(cache.getForAgent(agent.id), undefined);
        await cache.rebuildAll([project], [conversation], [agent], new Map());
        assert.equal(cache.getForAgent(agent.id), undefined);
        assert.equal(fallbacks, 0);
        const open = t.mock.method(
          runtime.services.harnessStorage,
          "openAgentStorage",
          (selected) => coldStorage.openAgentStorage(selected),
        );
        const identity = await runtime.services.workbenchRun.submitAgentRun(
          agent.id,
          prompt,
          undefined,
          { idempotencyKey: "constructor-integrity-assignment" },
        );
        const failed = await runtime.services.workbenchRun.waitForRun(
          identity.runId,
          AbortSignal.timeout(15_000),
        );
        assert.equal(failed.run.status, "failed");
        assert.equal(failed.run.failure?.code, "MODEL_HISTORY_INVALID");
        assert.equal(failed.run.failure?.retryable, false);
        assert.equal(failed.run.failure?.continuable, false);
        assert.equal(failed.run.attempt, 1);
        assert.equal(requests, 0);
        const input = (
          await new AgentInputRepository(storage).load(agent.id)
        )?.inputs.find((item) => item.id === failed.run.initialInputId);
        assert.equal(input?.state, "pending");
        assert.equal(input?.text, prompt);
        assert.equal(input?.delivery, undefined);
        await assert.rejects(access(output), { code: "ENOENT" });
        open.mock.restore();
        await runtime.services.workbenchRun.settledInputWork();
        await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(
          requests,
          0,
          "restoring model availability does not authorize retry/replay",
        );
        await assert.rejects(access(output), { code: "ENOENT" });
        assert.equal(
          (await new AgentInputRepository(storage).load(agent.id))?.inputs.find(
            (item) => item.id === input?.id,
          )?.state,
          "pending",
        );
      } finally {
        t.mock.restoreAll();
        await shutdownServerRuntime(runtime.runtime);
        await coldJournal?.close();
        provider.unregister();
        await rm(home, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 20,
        });
      }
    });
  }
}
