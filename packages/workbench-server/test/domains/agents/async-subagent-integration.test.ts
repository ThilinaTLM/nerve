import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { asyncSubagentToolNames } from "@nervekit/contracts/agents";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import {
  initializeStorage,
  writeSettings,
} from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";

it("executes an autonomous teammate in the shared workspace and wakes an idle lead without leaking child history", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-async-team-"));
  const provider = "nerve-scripted-async-team";
  const registration = registerAgentScriptedProvider({
    provider,
    steps: [
      {
        type: "toolCall",
        id: "child_write",
        name: "write",
        args: { path: "component.txt", content: "implemented by child" },
      },
      { type: "assistantText", text: "Child implementation is ready." },
      { type: "assistantText", text: "Lead received the teammate completion." },
      {
        type: "assistantText",
        text: "Follow-up completed with retained context.",
      },
      { type: "assistantText", text: "Lead accepted the follow-up." },
    ],
  });
  const storage = await initializeStorage(root);
  storage.settings = await writeSettings(storage, {
    ...storage.settings,
    tools: {
      ...storage.settings.tools,
      disabled: storage.settings.tools.disabled.filter(
        (name) => !(asyncSubagentToolNames as readonly string[]).includes(name),
      ),
    },
  });
  const runtime = createRuntimeFixture(storage, "127.0.0.1", 0);
  try {
    await runtime.lifecycle.hydrate();
    const project = await runtime.services.projectLifecycle.createProject({
      dir: root,
    });
    const conversation =
      await runtime.services.conversationLifecycle.createConversation({
        projectId: project.id,
      });
    const lead = await runtime.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      permissionLevel: "autonomous",
      model: { provider, modelId: "scripted-fast" },
    });
    const created = await runtime.services.tools.requestTool(
      lead,
      "subagent_new",
      { name: "API" },
    );
    assert.equal(created.toolCall.status, "completed");
    const createdStatus = created.toolCall.result?.details as { name: string };
    assert.equal(createdStatus.name, "API");
    const child = runtime.services.agentLifecycle
      .listAgents()
      .find(
        (agent) => agent.parentAgentId === lead.id && agent.name === "API",
      )!;
    const prompted = await runtime.services.tools.requestTool(
      lead,
      "subagent_prompt",
      {
        name: "API",
        prompt: "Write component.txt in the shared working directory.",
      },
    );
    assert.equal(prompted.toolCall.status, "completed");
    const receipt = prompted.toolCall.result?.details as { runId: string };
    assert.ok(receipt.runId);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const notices = await storage.canonicalStore.listSubagentCompletions(
        lead.id,
      );
      if (notices.some((record) => record.consumedAt)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const notices = await storage.canonicalStore.listSubagentCompletions(
      lead.id,
    );
    assert.equal(notices.length, 1);
    assert.ok(
      notices[0]?.consumedAt,
      "lead must consume the durable completion notification",
    );
    assert.equal(
      await readFile(join(root, "component.txt"), "utf8"),
      "implemented by child",
    );
    const status = await runtime.services.asyncSubagents.status(lead.id, "API");
    assert.equal(status.state, "idle");
    assert.match(status.response?.text ?? "", /Child implementation is ready/);
    assert.equal(status.agentId, child.id);
    assert.doesNotMatch(created.toolCall.result?.content ?? "", /agentId/);
    const transcript = await runtime.services.subagentTranscripts.get(
      lead.id,
      child.id,
    );
    assert.equal(transcript.activeRun, undefined);
    assert.ok(
      transcript.entries.some((entry) =>
        /Child implementation is ready/.test(entry.text),
      ),
    );
    const snapshot =
      await runtime.services.conversationQuery.getConversationSnapshot(
        conversation.id,
      );
    assert.ok(
      snapshot.entries.some((entry) => /Lead received/.test(entry.text ?? "")),
    );
    assert.ok(snapshot.entries.every((entry) => entry.agentId !== child.id));
    const notifications = snapshot.entries.filter(
      (entry) => entry.details?.type === "subagent_event",
    );
    assert.ok(notifications.length > 0);
    for (const entry of notifications) {
      assert.match(entry.text ?? "", /teammate API/);
      assert.doesNotMatch(
        entry.text ?? "",
        /agent_child|Active owned background tasks/,
      );
    }
    assert.equal(snapshot.conversation.activeAgentId, lead.id);
    const denied = await runtime.services.tools.requestTool(
      runtime.services.agentLifecycle.getAgent(child.id),
      "ask_user",
      { question: "This must not reach the user." },
    );
    assert.equal(denied.toolCall.status, "denied");
    const tools = await runtime.services.agentMechanics.activeToolNamesFor(
      runtime.services.agentLifecycle.getAgent(child.id),
    );
    assert.ok(tools.includes("write"));
    assert.ok(
      !tools.includes("ask_user") &&
        !tools.includes("plan_mode_enter") &&
        !tools.includes("explore") &&
        !tools.some((name) => name.startsWith("task_")),
    );
    await runtime.services.asyncSubagents.prompt(
      lead.id,
      "API",
      "Review your previous implementation.",
    );
    const followUpDeadline = Date.now() + 15_000;
    while (Date.now() < followUpDeadline) {
      const records = await storage.canonicalStore.listSubagentCompletions(
        lead.id,
      );
      if (records.filter((record) => record.consumedAt).length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(
      (await storage.canonicalStore.listSubagentCompletions(lead.id)).filter(
        (record) => record.consumedAt,
      ).length,
      2,
    );
    const history = await runtime.services.harnessStorage.openAgentStorage(
      runtime.services.agentLifecycle.getAgent(child.id),
    );
    const serialized = JSON.stringify(await history.getEntries());
    assert.match(serialized, /Write component.txt/);
    assert.match(serialized, /Review your previous implementation/);
    assert.doesNotMatch(serialized, /Lead received the teammate completion/);
    const parentStorage =
      await runtime.services.harnessStorage.openStorage(conversation);
    const parentLeaf = await parentStorage.getLeafId();
    const childLeaf = await history.getLeafId();
    const childEntries = await history.getEntries();
    const firstKeptEntryId = childEntries.find(
      (entry) => entry.type === "message",
    )!.id;
    const compactionId = "entry_child_compaction";
    const timestamp = new Date().toISOString();
    await runtime.services.conversationLifecycle.appendCompactionAtomic(
      {
        id: compactionId,
        conversationId: conversation.id,
        agentId: child.id,
        parentEntryId: childLeaf,
        role: "system",
        kind: "compaction",
        text: "Child summary",
        createdAt: timestamp,
      },
      {
        id: compactionId,
        type: "compaction",
        parentId: childLeaf,
        timestamp,
        summary: "Child summary",
        firstKeptEntryId,
        tokensBefore: 100,
      },
    );
    assert.equal(await parentStorage.getLeafId(), parentLeaf);
    assert.equal(await history.getLeafId(), compactionId);
    assert.ok(
      runtime.services.conversationLifecycle
        .getConversationTree(conversation.id)
        .nodes.every((node) => node.entry.agentId !== child.id),
    );
    await runtime.services.asyncSubagentNotifications.recover();
    assert.equal(
      (await storage.canonicalStore.listSubagentCompletions(lead.id)).length,
      2,
    );
  } finally {
    await shutdownServerRuntime(runtime.runtime);
    registration.unregister();
    await rm(root, { recursive: true, force: true });
  }
});
