import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { createRuntimeFixture } from "../../support/runtime-fixture.js";
import { initializeStorage } from "../../../src/infrastructure/storage-bootstrap/index.js";
import { shutdownServerRuntime } from "../../../src/app/runtime/server-runtime.js";

test("INV-AGENT-01 executes Explore in an independent canonical conversation", async () => {
  const registration = registerAgentScriptedProvider({
    provider: "nerve-scripted-canonical-explore",
    steps: [
      {
        type: "toolCall",
        id: "explore_child_ls_1",
        name: "ls",
        args: { path: "." },
      },
      { type: "assistantText", text: "The child inspected the project." },
    ],
  });
  const home = await mkdtemp(join(tmpdir(), "nerve-canonical-explore-"));
  const storage = await initializeStorage(home);
  storage.settings.retry.enabled = false;
  const projectDir = join(home, "workspace");
  await mkdir(projectDir);
  const fixture = createRuntimeFixture(storage, "127.0.0.1", 0);
  try {
    await fixture.lifecycle.hydrate();
    const project = await fixture.services.projectLifecycle.createProject({
      dir: projectDir,
    });
    const conversation =
      await fixture.services.canonicalConversationLifecycle.createConversation({
        projectId: project.id,
      });
    const parent = await fixture.services.agentLifecycle.createAgent({
      projectId: project.id,
      conversationId: conversation.id,
      model: {
        provider: "nerve-scripted-canonical-explore",
        modelId: "scripted-fast",
      },
    });
    const result = await fixture.services.workbenchRun.runExplore(
      parent,
      {
        tasks: [{ task: "List the project and report what is present." }],
        context:
          "The parent inspected the project root and found several files, but still needs an independent read-only listing and concise report.",
      },
      {
        parentRunId: "run_parent_test",
        parentToolCallId: "tool_parent_test",
      },
    );
    assert.equal(
      result.reports[0]?.status,
      "completed",
      JSON.stringify(result),
    );
    assert.match(
      result.reports[0]?.report ?? "",
      /child inspected the project/i,
    );
    const child = fixture.services.agentLifecycle
      .listAgents()
      .find((agent) => agent.parentAgentId === parent.id);
    assert.ok(child);
    assert.notEqual(child.conversationId, parent.conversationId);
    const childPage = await fixture.services.timelinePages.page({
      conversationId: child.conversationId,
      pageSize: 50,
    });
    assert.equal(childPage.kind, "page");
    assert.match(
      JSON.stringify(childPage.kind === "page" ? childPage.page.entries : []),
      /child inspected the project/i,
    );
    const parentPage = await fixture.services.timelinePages.page({
      conversationId: parent.conversationId,
      pageSize: 50,
    });
    assert.equal(parentPage.kind, "page");
    assert.deepEqual(
      parentPage.kind === "page" ? parentPage.page.entries : [],
      [],
    );
    const relationships = await storage.canonicalStore.listDocuments<unknown>(
      "canonical_child_execution",
      "run_parent_test",
    );
    assert.equal(relationships.length, 1);
    assert.equal(
      (relationships[0]?.data as { state?: string }).state,
      "completed",
    );
    const transcript = await fixture.services.subagentTranscripts.get(
      parent.id,
      child.id,
    );
    assert.equal(transcript.conversationId, child.conversationId);
  } finally {
    registration.unregister();
    await shutdownServerRuntime(fixture.runtime);
    await storage.canonicalStore.close();
    await rm(home, { recursive: true, force: true });
  }
});
