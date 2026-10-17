import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerAgentScriptedProvider } from "@nervekit/harness/models";
import { executeEdit } from "@nervekit/tools/execution";
import { ConversationCore } from "../core.js";
import { createDelegationTools } from "../delegation/delegation-tools.js";
import {
  createConversation,
  options,
  waitUntil,
} from "../runtime/lifecycle-test-helpers.js";
import { openCoreStorage } from "../storage/core-storage.js";

for (const toolName of ["edit", "subagent_prompt"] as const) {
  test(`failed ${toolName} keeps structured details in its durable result`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "nerve-failed-details-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const database = join(directory, "core.sqlite");
    const path = join(directory, "target.txt");
    await writeFile(path, "original\n");
    const provider = registerAgentScriptedProvider({
      provider: `failed-details-${randomUUID()}`,
      model: "test",
      steps: [
        {
          type: "toolCalls",
          calls: [
            {
              id: "provider_failed",
              name: toolName,
              args:
                toolName === "edit"
                  ? {
                      path,
                      edits: [{ oldText: "missing", newText: "replacement" }],
                    }
                  : {
                      assignments: [
                        { name: "worker", profile: "missing", prompt: "Help" },
                      ],
                    },
            },
          ],
        },
        { type: "waitForAbort" },
      ],
    });
    t.after(() => provider.unregister());
    let thrownMessage = "";
    const config = options(
      directory,
      database,
      {
        resolve: async () => {
          const model = provider.getModel("test");
          assert.ok(model);
          return { model };
        },
      },
      {
        execute: async ({ args }) => {
          try {
            return {
              kind: "completed",
              result: await executeEdit(args as Record<string, unknown>, {
                cwd: directory,
              }),
            };
          } catch (error) {
            assert.ok(error instanceof Error);
            thrownMessage = error.message;
            throw error;
          }
        },
        isReplaySafe: () => false,
      },
    );
    const core = new ConversationCore(config);
    for (const handler of createDelegationTools(core, {
      usableProfiles: async () => ["developer"],
      resolveProfile: async () => {
        throw new Error('Unknown profile "missing"');
      },
    })) {
      core.registerCoreTool({
        ...handler,
        execute: async (call, ctx) => {
          try {
            return await handler.execute(call, ctx);
          } catch (error) {
            assert.ok(error instanceof Error);
            thrownMessage = error.message;
            throw error;
          }
        },
      });
    }
    let closed = false;
    try {
      await core.start();
      await createConversation(core, "conv_failed");
      core.submitInput({
        conversationId: "conv_failed",
        inputId: "input_failed",
        text: "Use tool",
        source: "user",
      });
      await waitUntil(() =>
        core
          .getEventsSince("conv_failed", 0)
          .some((event) => event.type === "tool_call_response"),
      );
      const response = config.storage.events
        .since("conv_failed", 0)
        .find((event) => event.type === "tool_call_response")!;
      assert.equal(response.type, "tool_call_response");
      if (response.type !== "tool_call_response")
        assert.fail("Missing response");
      assert.equal(response.payload.outcome, "failed");
      const preview = response.payload.userProjection.resultPreview as {
        content: string;
        details: Record<string, unknown>;
      };
      assert.equal(preview.content, thrownMessage);
      assert.deepEqual(response.payload.agentProjection, [
        {
          type: "text",
          text: [
            "Tool execution failed.",
            `Tool: ${toolName}`,
            `Reason: ${thrownMessage}`,
            ...(toolName === "edit" ? [`Resource: ${path}`] : []),
            "Next action: inspect the reason, adjust the request if appropriate, and retry only when safe.",
          ].join("\n"),
        },
      ]);
      if (toolName === "edit") {
        assert.equal(preview.details.appliedCount, 0);
        assert.deepEqual(preview.details.operations, [
          {
            index: 0,
            type: "replace_text",
            source: "edits",
            sourceIndex: 0,
            status: "failed",
            error: thrownMessage,
          },
        ]);
        assert.equal(await readFile(path, "utf8"), "original\n");
      } else {
        const assignments = preview.details.assignments as {
          name: string;
          profile: string;
          disposition: string;
          reason: string;
        }[];
        assert.equal(assignments.length, 1);
        assert.equal(assignments[0].name, "worker");
        assert.equal(assignments[0].profile, "missing");
        assert.equal(assignments[0].disposition, "rejected");
        assert.match(assignments[0].reason, /Unknown profile "missing"/);
      }
      const payloadAsset = config.storage.assets
        .list("conv_failed")
        .find((asset) => asset.category === "payload")!;
      const complete = JSON.parse(
        await readFile(join(directory, payloadAsset.logicalPath), "utf8"),
      ) as { content: string; details: Record<string, unknown> };
      assert.equal(complete.content, thrownMessage);
      assert.deepEqual(
        toolName === "edit"
          ? complete.details.operations
          : complete.details.assignments,
        toolName === "edit"
          ? preview.details.operations
          : preview.details.assignments,
      );
      await core.close();
      closed = true;
      const reloaded = openCoreStorage(database);
      try {
        const stored = reloaded.events
          .since("conv_failed", 0)
          .find((event) => event.id === response.id);
        assert.deepEqual(stored, response);
      } finally {
        reloaded.close();
      }
    } finally {
      if (!closed) await core.close();
    }
  });
}
