import assert from "node:assert/strict";
import type { AssistantMessage, Message, Model } from "@earendil-works/pi-ai";
import {
  type AgentContext,
  type AgentLoopConfig,
  type AgentTool,
  runAgentLoop,
  type StreamFn,
} from "../packages/agent-runtime/src/index.ts";
import { coreToolDefinitions } from "../packages/agent-tools/src/index.ts";

const model: Model<string> = {
  provider: "nerve-debug",
  id: "debug-model",
  name: "Debug Model",
  api: "debug-api",
  input: ["text"],
  output: ["text"],
} as Model<string>;

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    provider: model.provider,
    api: model.api,
    model: model.id,
    stopReason,
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function streamFrom(message: AssistantMessage): ReturnType<StreamFn> {
  return {
    async *[Symbol.asyncIterator]() {},
    result: async () => message,
  } as unknown as ReturnType<StreamFn>;
}

async function main() {
  console.log("Nerve core tool definitions:");
  for (const definition of coreToolDefinitions) {
    console.log(
      `- ${definition.name}: parameters=${Boolean(definition.parameters)} snippet=${Boolean(
        definition.promptSnippet,
      )} mode=${definition.executionMode ?? "default"}`,
    );
    assert.ok(definition.description);
    assert.ok(definition.parameters);
  }

  let providerSawTools = false;
  let toolExecuted = false;
  let turn = 0;
  const lsDefinition = coreToolDefinitions.find((tool) => tool.name === "ls");
  assert.ok(lsDefinition);

  const lsTool: AgentTool = {
    name: lsDefinition.name,
    label: lsDefinition.label,
    description: lsDefinition.description,
    parameters: lsDefinition.parameters,
    executionMode: "sequential",
    execute: async () => {
      toolExecuted = true;
      return {
        content: [{ type: "text", text: "entries:\nREADME.md\npackages/" }],
        details: { debug: true },
      };
    },
  };

  const context: AgentContext = {
    systemPrompt: "Debug tool wiring.",
    messages: [{ role: "user", content: "List files", timestamp: Date.now() }],
    tools: [lsTool],
  };

  const config: AgentLoopConfig = {
    model,
    convertToLlm: (messages) => messages as Message[],
  };

  const events: string[] = [];
  await runAgentLoop(
    [],
    context,
    config,
    (event) => events.push(event.type),
    undefined,
    async (_model, llmContext) => {
      providerSawTools = (llmContext.tools?.length ?? 0) > 0;
      turn++;
      if (turn === 1) {
        return streamFrom(
          assistant(
            [
              {
                type: "toolCall",
                id: "tool_debug_list",
                name: "ls",
                arguments: { path: "." },
              },
            ],
            "toolUse",
          ),
        );
      }
      return streamFrom(
        assistant(
          [{ type: "text", text: "Saw README.md and packages/." }],
          "stop",
        ),
      );
    },
  );

  assert.equal(
    providerSawTools,
    true,
    "provider context did not include tools",
  );
  assert.equal(toolExecuted, true, "tool proxy was not executed");
  assert.ok(
    events.includes("tool_execution_start"),
    "missing tool_execution_start event",
  );
  assert.ok(
    events.includes("tool_execution_end"),
    "missing tool_execution_end event",
  );

  console.log("Agent tool wiring debug passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
