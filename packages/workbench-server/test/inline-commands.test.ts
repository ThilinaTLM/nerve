import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { EventEnvelope, ToolCallRecord } from "@nervekit/contracts";
import { createOrchestratorState } from "../src/app/orchestrator-state.js";
import { HttpError } from "../src/http/errors.js";
import { initializeStorage } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];
const model = { provider: "nerve-faux", modelId: "faux-fast" } as const;

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function createProjectConversationAgent() {
  const storage = await initializeStorage(await tempHome("nerve-inline-cmd-"));
  const state = createOrchestratorState(storage, "127.0.0.1", 0);
  await state.registry.hydrate();
  const project = await state.registry.createProject({
    dir: storage.paths.home,
  });
  const conversation = await state.registry.createConversation({
    projectId: project.id,
  });
  const agent = await state.registry.createAgent({
    projectId: project.id,
    conversationId: conversation.id,
    model,
  });
  return { state, project, conversation, agent };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 30000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function collectEvents(
  state: Awaited<ReturnType<typeof createProjectConversationAgent>>["state"],
): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  state.events.subscribe((event) => events.push(event));
  return events;
}

function mockBashTool(
  state: Awaited<ReturnType<typeof createProjectConversationAgent>>["state"],
  output: string,
  calls: Array<{ toolName: string; args: Record<string, unknown> }> = [],
): () => void {
  const originalRequestToolAndWait =
    state.registry.tools.requestToolAndWait.bind(state.registry.tools);
  state.registry.tools.requestToolAndWait = async (
    toolAgent,
    toolName,
    args,
    options,
  ) => {
    calls.push({ toolName, args });
    return {
      id: "tool_01HN0000000000000000000000",
      agentId: toolAgent.id,
      conversationId: toolAgent.conversationId,
      projectId: toolAgent.projectId,
      toolName,
      runId: options?.runId,
      risk: "command",
      args,
      cwd: toolAgent.projectDir,
      status: "completed",
      result: {
        content: output,
        stdout: output,
        stderr: "",
        details: { exitCode: 0 },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as ToolCallRecord;
  };
  return () => {
    state.registry.tools.requestToolAndWait = originalRequestToolAndWait;
  };
}

describe("inline command prompts", () => {
  it("runs leading bang prompts as command-only transcript entries", async () => {
    const { state, conversation, agent } =
      await createProjectConversationAgent();
    try {
      const events = collectEvents(state);
      const bashCalls: Array<{
        toolName: string;
        args: Record<string, unknown>;
      }> = [];
      const restoreBashTool = mockBashTool(state, "inline-ok", bashCalls);
      await state.registry.promptAgent(agent.id, { text: "!printf inline-ok" });
      await waitFor(() =>
        events.some((event) => event.type === "run.completed"),
      );

      // The command runs as a single bash tool call.
      assert.equal(bashCalls.length, 1);
      assert.equal(bashCalls[0].toolName, "bash");
      assert.deepEqual(bashCalls[0].args, { command: "printf inline-ok" });

      const entries = state.registry.getConversationEntries(conversation.id);
      assert.equal(entries.length, 1);
      assert.equal(entries[0]?.role, "system");
      assert.equal(
        (entries[0]?.details as { type?: string } | undefined)?.type,
        "inline_command_result",
      );
      assert.match(entries[0]?.text ?? "", /printf inline-ok/);
      assert.match(entries[0]?.text ?? "", /inline-ok/);

      // No harness/LLM activity: no user or assistant entries and no live
      // message streaming events were ever produced.
      assert.equal(
        entries.some(
          (entry) => entry.role === "user" || entry.role === "assistant",
        ),
        false,
      );
      assert.equal(
        events.some((event) => event.type.startsWith("conversation.live.")),
        false,
      );

      // The agent settles back to idle once the command-only run completes.
      await waitFor(() => state.registry.getAgent(agent.id).status === "idle");
      restoreBashTool();
    } finally {
      state.index.close();
    }
  });

  it("expands executable prompt blocks before sending to the model", async () => {
    const { state, conversation, agent } =
      await createProjectConversationAgent();
    const events = collectEvents(state);
    try {
      await state.registry.promptAgent(agent.id, {
        text: [
          "Use this command output.",
          "",
          "```!!!",
          "printf block-ok",
          "```",
        ].join("\n"),
      });
      await waitFor(() =>
        events.some((event) => event.type === "run.completed"),
      );

      const entries = state.registry.getConversationEntries(conversation.id);
      const user = entries.find((entry) => entry.role === "user");
      const assistant = entries.find((entry) => entry.role === "assistant");
      assert.ok(user);
      assert.ok(assistant);
      assert.doesNotMatch(user.text, /```!!!/);
      assert.match(
        user.text,
        /```\n\$ printf block-ok\n\n> exit code: 0, status: completed\nblock-ok\n```/,
      );
      assert.equal((user.text.match(/```/g) ?? []).length, 2);
      assert.equal(
        events.some((event) => event.type === "toolCall.updated"),
        false,
      );
    } finally {
      state.index.close();
    }
  });

  it("rejects command-mode prompts while the agent is already running", async () => {
    const { state, agent } = await createProjectConversationAgent();
    try {
      await state.registry.promptAgent(agent.id, { text: "Keep working." });

      await assert.rejects(
        () => state.registry.promptAgent(agent.id, { text: "!pwd" }),
        (error) =>
          error instanceof HttpError &&
          error.status === 409 &&
          error.code === "AGENT_BUSY",
      );
    } finally {
      state.index.close();
    }
  });
});
