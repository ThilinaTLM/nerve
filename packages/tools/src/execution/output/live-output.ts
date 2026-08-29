import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { ToolExecutionOutputUpdate } from "../execution-context.js";
import { splitLiveOutputChunks } from "./output-budget.js";

export type LiveOutputObserver = (
  update: ToolExecutionOutputUpdate,
) => void | Promise<void>;

/**
 * Decodes process bytes without splitting UTF-8 characters and serializes
 * bounded live-output delivery. Full process buffers remain owned by callers.
 */
export class LiveOutputDelivery {
  readonly #decoders = {
    stdout: new StringDecoder("utf8"),
    stderr: new StringDecoder("utf8"),
  };
  #pending: Promise<void> = Promise.resolve();

  constructor(private readonly observer?: LiveOutputObserver) {}

  write(stream: "stdout" | "stderr", chunk: Buffer, source?: Readable): void {
    const text = this.#decoders[stream].write(chunk);
    if (!text) return;
    const canPause = typeof source?.pause === "function";
    if (canPause) source.pause();
    const resume = () => {
      if (canPause && typeof source?.resume === "function") source.resume();
    };
    void this.#enqueue(stream, text).then(resume, resume);
  }

  async end(): Promise<void> {
    for (const stream of ["stdout", "stderr"] as const) {
      const tail = this.#decoders[stream].end();
      if (tail) this.#enqueue(stream, tail);
    }
    await this.#pending;
  }

  #enqueue(stream: "stdout" | "stderr", text: string): Promise<void> {
    this.#pending = this.#pending.then(async () => {
      for (const chunk of splitLiveOutputChunks(text)) {
        await this.observer?.({ kind: "output", stream, chunk });
      }
    });
    return this.#pending;
  }
}
