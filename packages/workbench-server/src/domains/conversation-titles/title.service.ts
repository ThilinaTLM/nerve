import { completeSimpleWithModel } from "@nervekit/harness/models";
import {
  TITLE_SYSTEM_INSTRUCTION,
  validateGeneratedTitle,
  type TitleGenerationInput,
} from "@nervekit/conversation-core";
import type { ModelPort } from "@nervekit/conversation-core";
import type { ConversationTitlesSettings } from "@nervekit/contracts/settings";
import {
  TITLE_TEST_PROMPT,
  type TitleTestResult,
} from "@nervekit/contracts/settings";

type Job = {
  input: TitleGenerationInput;
  signal: AbortSignal;
  resolve(value: string): void;
  reject(error: Error): void;
};
export class ConversationTitleService {
  private active = 0;
  private readonly queue: Job[] = [];
  constructor(
    private readonly options: {
      settings(): ConversationTitlesSettings;
      resolve: ModelPort["resolve"];
      complete?: typeof completeSimpleWithModel;
      log(data: Record<string, unknown>): void;
    },
  ) {}
  settings = (): ConversationTitlesSettings => this.options.settings();
  cancelQueued(): void {
    for (const job of this.queue.splice(0)) job.reject(new Error("disabled"));
  }
  generateTitle = (
    input: TitleGenerationInput,
    signal: AbortSignal,
  ): Promise<string> => {
    if (!this.settings().enabled) return Promise.reject(new Error("disabled"));
    if (this.active >= 2 && this.queue.length >= 8) {
      this.options.log({ category: "overflow", model: input.model });
      return Promise.reject(new Error("overflow"));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ input, signal, resolve, reject });
      this.drain();
    });
  };
  private drain(): void {
    if (!this.settings().enabled) {
      this.cancelQueued();
      return;
    }
    while (this.active < 2 && this.queue.length) {
      const job = this.queue.shift()!;
      if (job.signal.aborted) {
        job.reject(new Error("cancelled"));
        continue;
      }
      this.active++;
      void this.run(job)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
  private async run(job: Job): Promise<string> {
    const started = performance.now();
    const signal = AbortSignal.any([job.signal, AbortSignal.timeout(5000)]);
    let category = "ready";
    let usage: unknown;
    try {
      const request = (async () => {
        const resolved = await this.options.resolve(job.input.model);
        signal.throwIfAborted();
        if (!resolved.apiKey) throw new Error("auth");
        if (
          !resolved.model.input.includes("text") ||
          resolved.model.maxTokens <= 0
        )
          throw new Error("unavailable");
        const message = await (
          this.options.complete ?? completeSimpleWithModel
        )(
          resolved.model,
          {
            systemPrompt: TITLE_SYSTEM_INSTRUCTION,
            messages: [
              {
                role: "user",
                content: `<untrusted_prompt>\n${job.input.text}\n</untrusted_prompt>`,
                timestamp: Date.now(),
              },
            ],
          },
          {
            apiKey: resolved.apiKey,
            headers: { ...resolved.model.headers, ...resolved.headers },
            signal,
            maxTokens: 64,
            reasoning: "minimal",
          },
        );
        usage = message.usage;
        if (message.stopReason === "error" || message.stopReason === "aborted")
          throw new Error(message.errorMessage ?? "provider");
        const title = validateGeneratedTitle(
          message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
          job.input.text,
        );
        if (!title) throw new Error("invalid output");
        return title;
      })();
      return await new Promise<string>((resolve, reject) => {
        const abort = () =>
          reject(
            new Error(
              signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled",
            ),
          );
        signal.addEventListener("abort", abort, { once: true });
        request
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
        if (signal.aborted) abort();
      });
    } catch (error) {
      category = titleErrorCategory(error);
      throw new Error(category, { cause: error });
    } finally {
      this.options.log({
        category,
        model: job.input.model,
        latencyMs: Math.round(performance.now() - started),
        usage,
      });
    }
  }
  async test(): Promise<TitleTestResult> {
    const model = this.settings().model;
    if (!model || !this.settings().enabled) return { category: "unavailable" };
    const started = performance.now();
    try {
      const title = await this.generateTitle(
        {
          conversationId: "test",
          sourceMessageId: "test",
          model,
          text: TITLE_TEST_PROMPT,
        },
        new AbortController().signal,
      );
      return {
        category: "success",
        title,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return { category: titleErrorCategory(error) };
    }
  }
}
export function titleErrorCategory(
  error: unknown,
): "timeout" | "auth" | "rate limit" | "invalid output" | "unavailable" {
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out/iu.test(message)) return "timeout";
  if (/auth|credential|401|403/iu.test(message)) return "auth";
  if (/rate|429/iu.test(message)) return "rate limit";
  if (/invalid output/iu.test(message)) return "invalid output";
  return "unavailable";
}
