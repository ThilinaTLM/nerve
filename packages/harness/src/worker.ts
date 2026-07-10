import { createInterface } from "node:readline";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
  type AgentWorkerPromptMessage,
  type AgentWorkerServerMessage,
  agentWorkerClientMessageSchema,
} from "@nervekit/contracts";
import { streamAgentPrompt } from "./index.js";

let currentRun:
  | {
      id: string;
      abortController: AbortController;
    }
  | undefined;

function send(message: AgentWorkerServerMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function assistantMessageText(message: AssistantMessage | undefined): string {
  if (!message) return "";
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

async function runPrompt(message: AgentWorkerPromptMessage): Promise<void> {
  if (currentRun) {
    send({
      type: "error",
      id: message.id,
      message: "Agent worker is already running a prompt.",
    });
    return;
  }

  const abortController = new AbortController();
  currentRun = { id: message.id, abortController };
  let assistantText = "";
  let finalMessage: AssistantMessage | undefined;
  send({ type: "started", id: message.id });

  try {
    for await (const event of streamAgentPrompt({
      systemPrompt: message.systemPrompt,
      messages: message.messages as Message[],
      model: message.model,
      apiKey: message.auth?.apiKey,
      headers: message.auth?.headers,
      signal: abortController.signal,
    })) {
      if (event.type === "text_delta") {
        assistantText += event.delta;
        send({ type: "text_delta", id: message.id, delta: event.delta });
      }
      if (event.type === "done") finalMessage = event.message;
      if (event.type === "error") throw new Error(event.error.errorMessage);
    }

    send({
      type: "done",
      id: message.id,
      text: assistantText || assistantMessageText(finalMessage),
      message: finalMessage,
    });
  } catch (error) {
    send({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
      aborted: abortController.signal.aborted,
    });
  } finally {
    currentRun = undefined;
    setImmediate(() => process.exit(0));
  }
}

const input = createInterface({ input: process.stdin });

input.on("line", (line) => {
  void (async () => {
    const message = agentWorkerClientMessageSchema.parse(JSON.parse(line));
    if (message.type === "prompt") {
      await runPrompt(message);
      return;
    }

    if (currentRun?.id === message.id) currentRun.abortController.abort();
  })().catch((error) => {
    send({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      fatal: true,
    });
    setImmediate(() => process.exit(1));
  });
});

send({ type: "ready" });
