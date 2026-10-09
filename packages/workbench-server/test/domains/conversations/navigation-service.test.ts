import { resolveConversationNavigationAgent } from "../../../src/domains/conversations/journal-backed-navigation.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApplicationError } from "../../../src/core/application-error.js";
import { navigationFixture, modelEntry } from "./navigation.fixture.js";

function code(expected: string) {
  return (error: unknown) =>
    error instanceof ApplicationError && error.code === expected;
}

describe("NavigationService", () => {
  it("atomically publishes references for branch summaries larger than the public text limit", async (t) => {
    const h = await navigationFixture(t);
    const before = await h.journal.load(h.conversationId);
    const revision = before.revision;
    const updated = await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
      summarize: true,
      summaryInstructions: "instruction ".repeat(2000),
    });
    const after = await h.journal.loadFresh(h.conversationId);
    assert.equal(after.revision, revision + 1);
    const summary = after.entryById.get(updated.activeEntryId!)!;
    assert.ok(summary.text.length > 16384);
    assert.equal(summary.parentEntryId, "entry_target");
    assert.equal(
      after.modelEntryById.get(summary.id)?.parentId,
      "entry_target",
    );
    assert.equal(after.modelLeafId, summary.id);
    assert.equal(after.conversation?.activeEntryId, summary.id);
    const summarized = h.events.find(
      (event) => event.type === "conversation.branch_summarized",
    )!;
    assert.equal(summarized.data.entryId, summary.id);
    assert.equal(summarized.data.entry, undefined);
    const navigated = h.events.find(
      (event) => event.type === "conversation.navigated",
    )!;
    assert.equal(navigated.data.activeEntryId, summary.id);
    assert.equal(navigated.data.targetEntryId, "entry_target");
    assert.equal(navigated.data.summaryEntry, undefined);
    assert.equal(h.projection().fenced, true);
  });

  it("protects either cursor change until a live run is interrupted, while allowing a genuine no-op", async (t) => {
    const h = await navigationFixture(t);
    h.activeStatus("running");
    await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_old",
    });
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, {
        activeEntryId: "entry_target",
      }),
      code("CONVERSATION_RUN_ACTIVE"),
    );
    assert.equal(
      (await h.journal.load(h.conversationId)).modelLeafId,
      "entry_old",
    );
    h.activeStatus("interrupted");
    await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    const state = await h.journal.load(h.conversationId);
    assert.equal(state.modelLeafId, "entry_target");
    // Equality with metadata alone cannot bypass the guard.
    await h.journal.commit(h.conversationId, {
      kind: "fixture.leaf",
      events: [
        {
          kind: "model_context.leaf_changed",
          conversationId: h.conversationId,
          entryId: "entry_old",
        },
      ],
    });
    h.activeStatus("running");
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, {
        activeEntryId: "entry_target",
      }),
      code("CONVERSATION_RUN_ACTIVE"),
    );
  });

  it("rejects transcript-only run-status targets without durable or projection changes", async (t) => {
    const h = await navigationFixture(t);
    const state = await h.journal.load(h.conversationId);
    await h.journal.commit(h.conversationId, {
      kind: "fixture.status",
      events: [
        {
          kind: "conversation.entry_appended",
          conversationId: h.conversationId,
          entry: {
            id: "entry_run_status_fixture_failed",
            conversationId: h.conversationId,
            role: "system",
            kind: "run_status",
            text: "failed",
            createdAt: h.agent.createdAt,
          },
        },
      ],
    });
    const revision = state.revision;
    for (const activeEntryId of [
      "entry_run_status_fixture_failed",
      "entry_missing",
    ]) {
      await assert.rejects(
        h.service.navigateConversation(h.conversationId, { activeEntryId }),
        code("INVALID_NAVIGATION_TARGET"),
      );
      assert.equal(state.revision, revision);
      assert.equal(state.modelLeafId, "entry_old");
      assert.equal(h.projection().conversation.activeEntryId, "entry_old");
    }
    assert.deepEqual(h.events, []);
  });

  it("explicitly repairs a historical dangling leaf without summary; summary from that source fails", async (t) => {
    const h = await navigationFixture(t);
    await h.seedLegacyLeaf("entry_run_status_fixture_failed");
    const revision = (await h.journal.load(h.conversationId)).revision;
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, {
        activeEntryId: "entry_target",
        summarize: true,
      }),
      code("MODEL_HISTORY_INVALID"),
    );
    assert.equal((await h.journal.load(h.conversationId)).revision, revision);
    await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
      summarize: false,
    });
    const reopened = await h.journal.loadFresh(h.conversationId);
    assert.equal(reopened.modelLeafId, "entry_target");
    assert.equal(reopened.conversation?.activeEntryId, "entry_target");
    assert.equal(reopened.entries.length, 2);
    await h.service.navigateConversation(h.conversationId, {
      activeEntryId: null,
    });
    assert.equal(
      (await h.journal.loadFresh(h.conversationId)).modelLeafId,
      null,
    );
  });

  it("failed persistence leaves selection, leaf and both summary representations unchanged", async (t) => {
    const h = await navigationFixture(t);
    const before = await h.adapter.capture(h.conversationId);
    const persist = h.canonical.persistConversationCommit.bind(h.canonical);
    h.canonical.persistConversationCommit = async () => {
      throw new Error("forced persistence failure");
    };
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, {
        activeEntryId: "entry_target",
        summarize: true,
      }),
      /forced persistence failure/,
    );
    h.canonical.persistConversationCommit = persist;
    const state = await h.journal.loadFresh(h.conversationId);
    assert.equal(state.revision, before.revision);
    assert.equal(state.modelLeafId, "entry_old");
    assert.equal(state.entries.length, 2);
    assert.equal(state.modelEntries.length, 2);
    assert.equal(h.projection().conversation.activeEntryId, "entry_old");
    assert.deepEqual(h.events, []);
  });

  it("stale revision or leaf prevents atomic commit and cannot overwrite a competing cursor", async (t) => {
    const h = await navigationFixture(t);
    const before = await h.adapter.capture(h.conversationId);
    await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    await assert.rejects(
      h.adapter.commit(before, null),
      code("STALE_NAVIGATION"),
    );
    const current = await h.adapter.capture(h.conversationId);
    await assert.rejects(
      h.adapter.commit({ ...current, modelLeafId: "entry_old" }, null),
      code("STALE_NAVIGATION"),
    );
    assert.equal(
      (await h.journal.loadFresh(h.conversationId)).modelLeafId,
      "entry_target",
    );
  });

  it("committed navigation survives derived rebuild and notification failures", async (t) => {
    const h = await navigationFixture(t);
    h.rebuild(async () => {
      throw new Error("cache rebuild unavailable");
    });
    h.failNotifications();
    const updated = await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    assert.equal(updated.activeEntryId, "entry_target");
    assert.equal(h.projection().conversation.activeEntryId, "entry_target");
    assert.equal(h.projection().fenced, true);
    assert.equal(
      (await h.journal.loadFresh(h.conversationId)).modelLeafId,
      "entry_target",
    );
    assert.equal(h.failures.length, 2);
  });

  it("serializes run admission before journal navigation and checks run status inside the fence", async (t) => {
    const h = await navigationFixture(t);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admission = h.lock.exclusive(h.agent.id, async () => {
      entered();
      await gate;
      h.activeStatus("running");
    });
    await ready;
    const navigating = h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    const rejected = assert.rejects(
      navigating,
      code("CONVERSATION_RUN_ACTIVE"),
    );
    release();
    await admission;
    await rejected;
    assert.equal(
      (await h.journal.loadFresh(h.conversationId)).modelLeafId,
      "entry_old",
    );
  });

  it("allows only a genuinely empty no-agent root no-op, rejecting missing or child-view ownership", async (t) => {
    const empty = await navigationFixture(t, { empty: true });
    const revision = (await empty.journal.load(empty.conversationId)).revision;
    await empty.service.navigateConversation(empty.conversationId, {
      activeEntryId: null,
    });
    assert.equal(
      (await empty.journal.load(empty.conversationId)).revision,
      revision,
    );
    const h = await navigationFixture(t);
    h.agents.delete(h.agent.id);
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, { activeEntryId: null }),
      code("INVALID_NAVIGATION_OWNER"),
    );
    h.agents.set(h.agent.id, h.agent);
    const state = await h.journal.load(h.conversationId);
    await h.journal.commit(h.conversationId, {
      kind: "fixture.selected_child",
      events: [
        {
          kind: "conversation.upserted",
          conversationId: h.conversationId,
          conversation: {
            ...state.conversation!,
            activeAgentId: "agent_child",
          },
        },
      ],
    });
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, { activeEntryId: null }),
      code("INVALID_NAVIGATION_OWNER"),
    );
  });

  it("does not navigate to another owner's model-only target", async (t) => {
    const h = await navigationFixture(t);
    await h.journal.commit(h.conversationId, {
      kind: "fixture.child",
      events: [
        {
          kind: "model_context.entry_appended",
          conversationId: h.conversationId,
          ownerAgentId: "agent_child",
          entry: modelEntry("entry_child") as never,
        },
      ],
    });
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, {
        activeEntryId: "entry_child",
      }),
      code("INVALID_NAVIGATION_TARGET"),
    );
  });

  it("revalidates persisted owner under the journal lock before changing either representation", async (t) => {
    const h = await navigationFixture(t);
    const snapshot = await h.adapter.capture(h.conversationId);
    await h.canonical.writeDocument({
      namespace: "agent-context-binding",
      scopeId: "global",
      documentId: h.conversationId,
      data: { legacyRootAgentId: "agent_other" },
    });
    await assert.rejects(
      h.adapter.commit(snapshot, null),
      code("INVALID_NAVIGATION_OWNER"),
    );
    const state = await h.journal.loadFresh(h.conversationId);
    assert.equal(state.revision, snapshot.revision);
    assert.equal(state.modelLeafId, snapshot.modelLeafId);
    assert.equal(
      state.conversation?.activeEntryId,
      snapshot.conversation.activeEntryId,
    );
    assert.deepEqual(h.events, []);
  });

  it("releases admission before waiting on the derived context rebuild", async (t) => {
    const h = await navigationFixture(t);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.rebuild(async () => {
      entered();
      await gate;
    });
    const navigating = h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    await ready;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        h.lock.exclusive(h.agent.id, async () => {
          assert.equal(
            h.projection().conversation.activeEntryId,
            "entry_target",
          );
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Derived rebuild held admission")),
            1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
      release();
      await navigating;
    }
  });

  it("returns the committed outcome even when the derived-failure observer throws", async (t) => {
    const h = await navigationFixture(t);
    h.rebuild(async () => {
      throw new Error("derived rebuild unavailable");
    });
    h.failNotifications();
    h.failFailureReporter();
    const revision = (await h.journal.load(h.conversationId)).revision;
    const updated = await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    const committed = await h.journal.loadFresh(h.conversationId);
    assert.equal(updated.activeEntryId, "entry_target");
    assert.equal(committed.revision, revision + 1);
    assert.equal(committed.modelLeafId, "entry_target");
    assert.equal(h.projection().conversation.activeEntryId, "entry_target");
    assert.equal(h.failures.length, 2);
  });

  it("projects latest authoritative metadata when another commit completes between navigation persistence and projection", async (t) => {
    const h = await navigationFixture(t);
    const initial = await h.adapter.capture(h.conversationId);
    const commit = h.journal.commit.bind(h.journal);
    let metadataRevision: number | undefined;
    h.journal.commit = async (...args) => {
      const result = await commit(...args);
      if (args[1].kind === "conversation.navigated") {
        const state = await h.journal.load(h.conversationId);
        const metadata = await commit(h.conversationId, {
          kind: "fixture.metadata_updated",
          events: [
            {
              kind: "conversation.upserted",
              conversationId: h.conversationId,
              conversation: {
                ...state.conversation!,
                title: "Newer metadata",
                pinned: true,
              },
            },
          ],
        });
        metadataRevision = metadata.revision;
      }
      return result;
    };
    const updated = await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    const latest = await h.journal.loadFresh(h.conversationId);
    assert.equal(
      latest.revision,
      initial.revision + 2,
      "no metadata re-persist or navigation retry",
    );
    assert.equal(latest.revision, metadataRevision);
    assert.equal(h.projection().conversation.title, "Newer metadata");
    assert.equal(h.projection().conversation.pinned, true);
    assert.equal(h.projection().conversation.activeEntryId, "entry_target");
    assert.equal(h.projection().fenced, true);
    assert.equal(
      updated.title,
      initial.conversation.title,
      "command returns its own immutable committed outcome",
    );
    assert.equal(updated.activeEntryId, "entry_target");
    assert.equal(
      h.events.some((event) => event.type === "conversation.updated"),
      false,
    );
  });

  it("delayed navigation notifications cannot broadcast old metadata over a newer branch commit", async (t) => {
    const h = await navigationFixture(t);
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let rebuilds = 0;
    h.rebuild(async () => {
      if (++rebuilds === 1) {
        entered();
        await gate;
      }
    });
    const first = h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    await ready;
    const second = await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_old",
    });
    assert.equal(second.activeEntryId, "entry_old");
    const state = await h.journal.load(h.conversationId);
    await h.journal.commit(h.conversationId, {
      kind: "fixture.newer_metadata",
      events: [
        {
          kind: "conversation.upserted",
          conversationId: h.conversationId,
          conversation: { ...state.conversation!, title: "Newest title" },
        },
      ],
    });
    release();
    assert.equal(
      (await first).activeEntryId,
      "entry_target",
      "older action proof is not retargeted",
    );
    const latest = await h.journal.loadFresh(h.conversationId);
    assert.equal(latest.conversation?.activeEntryId, "entry_old");
    assert.equal(latest.conversation?.title, "Newest title");
    assert.equal(h.projection().conversation.activeEntryId, "entry_old");
    assert.equal(
      h.events.some((event) => event.type === "conversation.updated"),
      false,
    );
    assert.deepEqual(
      h.events
        .filter((event) => event.type === "conversation.navigated")
        .map((event) => event.data.activeEntryId),
      ["entry_old", "entry_target"],
      "notifications remain action references for authoritative refresh",
    );
  });

  it("resolves only the persisted root with an enumeration-forbidden registry; unbound duplicate claims cannot retarget it", async (t) => {
    const h = await navigationFixture(t);
    const unbound = { ...h.agent, id: "agent_unbound" };
    h.agents.set(unbound.id, unbound);
    await h.canonical.writeDocument({
      namespace: "agent",
      scopeId: "global",
      documentId: unbound.id,
      data: unbound,
    });
    h.agents.set(h.agent.id, { ...h.agent, name: "Untrusted cache name" });
    const requested: string[] = [];
    const readDocument = h.canonical.readDocument.bind(h.canonical);
    const reads: Array<[string, string, string]> = [];
    h.canonical.readDocument = async (...args) => {
      reads.push(args);
      return readDocument(...args);
    };
    const conversation = (await h.journal.load(h.conversationId)).conversation!;
    const resolved = await resolveConversationNavigationAgent(
      h.canonical,
      conversation,
      (id) => {
        requested.push(id);
        return h.agents.get(id);
      },
    );
    assert.deepEqual(requested, [h.agent.id]);
    assert.deepEqual(reads, [
      ["agent-context-binding", "global", h.conversationId],
      ["agent", "global", h.agent.id],
    ]);
    assert.equal(resolved?.id, h.agent.id);
    assert.equal(
      resolved?.name,
      h.agent.name,
      "registry metadata does not replace canonical owner truth",
    );
    await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    assert.equal(h.projection().conversation.activeEntryId, "entry_target");
    await assert.rejects(
      resolveConversationNavigationAgent(
        h.canonical,
        { ...conversation, activeAgentId: unbound.id },
        (id) => h.agents.get(id),
      ),
      code("INVALID_NAVIGATION_OWNER"),
    );
  });

  it("fails closed for missing or inconsistent exact registry rows without scanning other actors", async (t) => {
    const h = await navigationFixture(t);
    const revision = (await h.journal.load(h.conversationId)).revision;
    const invalidRows = [
      { ...h.agent, rootAgentId: "agent_foreign" },
      { ...h.agent, id: "agent_foreign" },
      { ...h.agent, conversationId: "conv_foreign" },
      { ...h.agent, projectId: "proj_foreign" },
      { ...h.agent, contextOwnerAgentId: h.agent.id },
      { ...h.agent, parentAgentId: "agent_parent" },
    ];
    for (const row of invalidRows) {
      h.agents.set(h.agent.id, row);
      await assert.rejects(
        h.service.navigateConversation(h.conversationId, {
          activeEntryId: null,
        }),
        code("INVALID_NAVIGATION_OWNER"),
      );
    }
    h.agents.delete(h.agent.id);
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, { activeEntryId: null }),
      code("INVALID_NAVIGATION_OWNER"),
    );
    assert.equal((await h.journal.load(h.conversationId)).revision, revision);
    assert.equal(h.projection().conversation.activeEntryId, "entry_old");
  });

  it("fails closed for malformed bindings or foreign/ineligible persisted owner rows", async (t) => {
    const h = await navigationFixture(t);
    const revision = (await h.journal.load(h.conversationId)).revision;
    for (const row of [
      { ...h.agent, id: "agent_foreign" },
      { ...h.agent, conversationId: "conv_foreign" },
      { ...h.agent, projectId: "proj_foreign" },
      { ...h.agent, contextOwnerAgentId: h.agent.id },
      { ...h.agent, parentAgentId: "agent_parent" },
    ]) {
      await h.canonical.writeDocument({
        namespace: "agent",
        scopeId: "global",
        documentId: h.agent.id,
        data: row,
      });
      await assert.rejects(
        h.service.navigateConversation(h.conversationId, {
          activeEntryId: null,
        }),
        code("INVALID_NAVIGATION_OWNER"),
      );
    }
    await h.canonical.writeDocument({
      namespace: "agent",
      scopeId: "global",
      documentId: h.agent.id,
      data: h.agent,
    });
    await h.canonical.writeDocument({
      namespace: "agent-context-binding",
      scopeId: "global",
      documentId: h.conversationId,
      data: { legacyRootAgentId: [h.agent.id, "agent_other"] },
    });
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, { activeEntryId: null }),
      code("INVALID_NAVIGATION_OWNER"),
    );
    await h.canonical.deleteDocument(
      "agent-context-binding",
      "global",
      h.conversationId,
    );
    await assert.rejects(
      h.service.navigateConversation(h.conversationId, { activeEntryId: null }),
      code("INVALID_NAVIGATION_OWNER"),
    );
    assert.equal((await h.journal.load(h.conversationId)).revision, revision);
    assert.equal(h.projection().conversation.activeEntryId, "entry_old");
    assert.deepEqual(h.events, []);
  });

  it("derives context only for the command's persisted root with registry enumeration forbidden", async (t) => {
    const h = await navigationFixture(t);
    const child = {
      ...h.agent,
      id: "agent_child",
      parentAgentId: h.agent.id,
      contextOwnerAgentId: "agent_child",
    };
    h.agents.set(child.id, child);
    await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    assert.deepEqual(h.rebuildTargets, [h.agent.id]);
    assert.equal(h.agents.get(child.id), child);
    assert.equal(h.projection().fenced, true);
    assert.equal(h.projection().conversation.activeEntryId, "entry_target");
  });

  it("missing exact control actor after commit is derived unavailability, not navigation rollback", async (t) => {
    const h = await navigationFixture(t);
    const revision = (await h.journal.load(h.conversationId)).revision;
    const commit = h.journal.commit.bind(h.journal);
    h.journal.commit = async (...args) => {
      const result = await commit(...args);
      if (args[1].kind === "conversation.navigated")
        h.agents.delete(h.agent.id);
      return result;
    };
    const updated = await h.service.navigateConversation(h.conversationId, {
      activeEntryId: "entry_target",
    });
    const persisted = await h.journal.loadFresh(h.conversationId);
    assert.equal(updated.activeEntryId, "entry_target");
    assert.equal(persisted.revision, revision + 1);
    assert.equal(persisted.modelLeafId, "entry_target");
    assert.deepEqual(h.rebuildTargets, []);
    assert.equal(h.failures.length, 1);
    assert.match(String(h.failures[0]), /control agent is unavailable/);
    assert.equal(
      h.events.filter((event) => event.type === "conversation.navigated")
        .length,
      1,
    );
  });
});
