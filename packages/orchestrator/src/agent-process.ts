import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
  type AgentWorkerClientMessage,
  agentWorkerServerMessageSchema,
  type ModelSelection,
} from "@nerve/shared";

export interface AgentProcessInput {
  runId: string;
  workerId?: string;
  systemPrompt?: string;
  messages: Message[];
  model?: ModelSelection;
}

export interface AgentProcessHandlers {
  onStarted?: () => Promise<void> | void;
  onTextDelta?: (delta: string) => Promise<void> | void;
}

export interface AgentProcessResult {
  text: string;
  message?: AssistantMessage;
}

export interface AgentProcessRun {
  runId: string;
  child: ChildProcessWithoutNullStreams;
  result: Promise<AgentProcessResult>;
  abort: () => void;
}

export class AgentProcessError extends Error {
  constructor(
    message: string,
    readonly aborted = false,
  ) {
    super(message);
  }
}

export function launchAgentProcess(
  input: AgentProcessInput,
  handlers: AgentProcessHandlers = {},
): AgentProcessRun {
  const workerPath = fileURLToPath(import.meta.resolve("@nerve/agent/worker"));
  const child = spawn(process.execPath, [workerPath], {
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  let settled = false;
  let ready = false;
  let aborted = false;
  let eventChain = Promise.resolve();

  const result = new Promise<AgentProcessResult>((resolve, reject) => {
    function enqueue(handler: () => Promise<void> | void): void {
      eventChain = eventChain.then(handler);
    }

    function settleResolve(value: AgentProcessResult): void {
      if (settled) return;
      settled = true;
      void eventChain.then(() => resolve(value), reject);
    }

    function settleReject(error: unknown): void {
      if (settled) return;
      settled = true;
      void eventChain.then(
        () => reject(error),
        () => reject(error),
      );
    }

    function send(message: AgentWorkerClientMessage): void {
      if (!child.stdin.writable) return;
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      settleReject(error);
    });

    child.once("exit", (code, signal) => {
      lines.close();
      if (settled) return;
      const detail = stderr.trim();
      settleReject(
        new AgentProcessError(
          aborted
            ? "Agent run was aborted."
            : `Agent worker exited before completion${signal ? ` (${signal})` : code === null ? "" : ` (${code})`}.${detail ? `\n${detail}` : ""}`,
          aborted,
        ),
      );
    });

    lines.on("line", (line) => {
      let parsed: ReturnType<typeof agentWorkerServerMessageSchema.parse>;
      try {
        parsed = agentWorkerServerMessageSchema.parse(JSON.parse(line));
      } catch (error) {
        settleReject(error);
        return;
      }

      if (parsed.type === "ready") {
        ready = true;
        if (!aborted) {
          send({
            type: "prompt",
            id: input.runId,
            systemPrompt: input.systemPrompt,
            messages: input.messages,
            model: input.model,
          });
        }
        return;
      }

      if (parsed.type === "started" && parsed.id === input.runId) {
        if (handlers.onStarted) enqueue(handlers.onStarted);
        return;
      }

      if (parsed.type === "text_delta" && parsed.id === input.runId) {
        if (handlers.onTextDelta)
          enqueue(() => handlers.onTextDelta?.(parsed.delta));
        return;
      }

      if (parsed.type === "done" && parsed.id === input.runId) {
        child.stdin.end();
        settleResolve({
          text: parsed.text,
          message: parsed.message as AssistantMessage | undefined,
        });
        return;
      }

      if (
        parsed.type === "error" &&
        (!parsed.id || parsed.id === input.runId)
      ) {
        settleReject(
          new AgentProcessError(parsed.message, parsed.aborted ?? aborted),
        );
      }
    });

    setTimeout(() => {
      if (!ready && !settled) {
        settleReject(
          new AgentProcessError("Agent worker did not become ready."),
        );
        child.kill("SIGTERM");
      }
    }, 10_000).unref();
  });

  function abort(): void {
    aborted = true;
    if (child.stdin.writable) {
      child.stdin.write(
        `${JSON.stringify({ type: "abort", id: input.runId } satisfies AgentWorkerClientMessage)}\n`,
      );
    }
    setTimeout(() => {
      if (!settled && !child.killed) child.kill("SIGTERM");
    }, 1000).unref();
    setTimeout(() => {
      if (!settled && !child.killed) child.kill("SIGKILL");
    }, 3000).unref();
  }

  return { runId: input.runId, child, result, abort };
}
