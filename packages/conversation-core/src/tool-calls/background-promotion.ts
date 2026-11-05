import type { AsyncBash, ToolCall } from "@nervekit/contracts/core";
import type { BackgroundProcess, ToolHostPort } from "../ports.js";

type ToolExecutionResultPayload = Extract<
  Awaited<ReturnType<ToolHostPort["execute"]>>,
  { kind: "completed" }
>["result"];

/** Where a backgrounded tool call continues; the async bash facade over the task service. */
export interface AsyncBashAdopter {
  adopt(input: {
    conversationId: string;
    toolCallId: string;
    command: string;
    cwd: string;
    process: BackgroundProcess;
  }): AsyncBash | Promise<AsyncBash>;
}

/** Hands a backgrounded tool call's process to background tasks and builds its final result. */
export class BackgroundPromotion {
  constructor(private readonly adopter: AsyncBashAdopter) {}

  /**
   * Adopt the process and return the settled result payload, or undefined when the call
   * no longer owns its execution (`lost`), in which case the process is cancelled.
   */
  async promote(input: {
    call: ToolCall;
    /** Fallback working directory when the result does not name one. */
    cwd: string;
    result: { process: BackgroundProcess; result: ToolExecutionResultPayload };
    lost(): boolean;
  }): Promise<ToolExecutionResultPayload | undefined> {
    const { call, result } = input;
    const details = objectDetails(result.result.details);
    let bash: AsyncBash;
    try {
      bash = await this.adopter.adopt({
        conversationId: call.conversationId,
        toolCallId: call.id,
        command: String(call.arguments.command ?? ""),
        cwd: typeof details.cwd === "string" ? String(details.cwd) : input.cwd,
        process: result.process,
      });
    } catch (error) {
      if (input.lost()) await result.process.cancel();
      throw error;
    }
    if (input.lost()) {
      await result.process.cancel();
      return undefined;
    }
    const output = result.result.content ? `\n${result.result.content}` : "";
    return {
      ...result.result,
      content: details.backgroundStart
        ? `Started async bash ${bash.id}.${output}`
        : `Still running; continues as async bash ${bash.id}. You will be notified on exit.${output}`,
      details: { ...details, asyncBashId: bash.id },
    };
  }
}

function objectDetails(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
