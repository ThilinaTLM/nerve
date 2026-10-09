import { createWriteStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawnManagedProcess } from "@nervekit/native";
import type {
  BackgroundProcess,
  ProcessPort,
} from "@nervekit/conversation-core";

export class CoreProcessHost implements ProcessPort {
  private readonly active = new Map<string, BackgroundProcess>();
  constructor(private readonly shellPath: string) {}

  async spawn(input: {
    command: string;
    cwd: string;
    artifactDir: string;
    timeoutMs?: number;
    env?: Record<string, string>;
    onProgress?(update: { chunk: string; stream: "stdout" | "stderr" }): void;
  }): Promise<BackgroundProcess> {
    await mkdir(input.artifactDir, { recursive: true });
    const outputFiles = {
      stdout: join(input.artifactDir, "stdout.txt"),
      stderr: join(input.artifactDir, "stderr.txt"),
    };
    const process = spawnManagedProcess(
      this.shellPath,
      ["-lc", input.command],
      {
        cwd: input.cwd,
        env: { ...globalThis.process.env, ...input.env },
        policy: {
          wallTimeMs: input.timeoutMs,
          output: { totalBytes: 16 * 1024 * 1024, overflow: "truncate" },
        },
      },
    );
    let cancelled = false;
    let exited = false;
    void process.exited.then(() => {
      exited = true;
    });
    for (const stream of ["stdout", "stderr"] as const)
      process[stream].on("data", (chunk: Buffer) =>
        input.onProgress?.({ stream, chunk: chunk.toString() }),
      );
    const drains = Promise.all([
      pipeline(process.stdout, createWriteStream(outputFiles.stdout)),
      pipeline(process.stderr, createWriteStream(outputFiles.stderr)),
    ]);
    const ref = process.identity;
    const terminal = (async () => {
      const [exit] = await Promise.all([process.closed, drains]);
      return {
        exitCode: exit.exitCode,
        status: cancelled
          ? ("cancelled" as const)
          : exit.reason === "timeout"
            ? ("timed_out" as const)
            : exit.exitCode === 0
              ? ("completed" as const)
              : ("failed" as const),
      };
    })();
    const background: BackgroundProcess = {
      ref,
      outputFiles,
      wait: () => terminal,
      cancel: async () => {
        if (exited) {
          await terminal;
          return;
        }
        cancelled = true;
        const result = await process.terminate("SIGKILL");
        if (!result.terminated)
          throw new Error(
            result.error ?? "Process termination could not be confirmed",
          );
        await terminal;
      },
    };
    this.active.set(ref, background);
    void terminal.finally(() => this.active.delete(ref)).catch(() => undefined);
    return background;
  }

  async start(
    input: Parameters<ProcessPort["start"]>[0],
  ): ReturnType<ProcessPort["start"]> {
    if (input.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const background = await this.spawn(input);
    const cancel = () => {
      void background.cancel().catch(() => undefined);
    };
    input.signal.addEventListener("abort", cancel, { once: true });
    if (input.signal.aborted) cancel();
    try {
      if (!input.ready) {
        if (input.signal.aborted) {
          await background.cancel();
          throw new DOMException("Cancelled", "AbortError");
        }
        return { process: background };
      }
      const ready = input.ready;
      const pattern =
        ready.kind === "pattern" ? new RegExp(ready.pattern) : undefined;
      let exited = false;
      void background.wait().then(
        () => {
          exited = true;
        },
        () => {
          exited = true;
        },
      );
      const deadline = Date.now() + (ready.timeoutMs ?? 30_000);
      while (Date.now() < deadline && !exited && !input.signal.aborted) {
        const output = await readFile(
          background.outputFiles.stdout,
          "utf8",
        ).catch(() => "");
        if (pattern?.test(output))
          return { process: background, readiness: { status: "ready" } };
        const url =
          ready.kind === "url"
            ? ready.url
            : ready.kind === "detected_url"
              ? // eslint-disable-next-line no-control-regex -- terminal output may contain ANSI escapes.
                output.match(/https?:\/\/[^\s\x1b]+/)?.[0]
              : undefined;
        if (url) {
          try {
            const response = await fetch(url, {
              signal: AbortSignal.any([
                input.signal,
                AbortSignal.timeout(1000),
              ]),
            });
            await response.body?.cancel();
            if (response.ok)
              return {
                process: background,
                readiness: { status: "ready", url },
              };
          } catch {
            /* Readiness can lag process startup. */
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (input.signal.aborted) {
        await background.cancel();
        throw new DOMException("Cancelled", "AbortError");
      }
      return {
        process: background,
        readiness: { status: exited ? "exited" : "timed_out" },
      };
    } catch (error) {
      await background.cancel().catch(() => undefined);
      throw error;
    } finally {
      input.signal.removeEventListener("abort", cancel);
    }
  }

  async run(input: Parameters<ProcessPort["run"]>[0]) {
    if (input.signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const process = spawnManagedProcess(
      this.shellPath,
      ["-lc", input.command],
      {
        cwd: input.cwd,
        policy: { output: { totalBytes: 1024 * 1024, overflow: "truncate" } },
      },
    );
    const stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    process.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    process.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const cancel = () => {
      void process.terminate("SIGKILL");
    };
    input.signal.addEventListener("abort", cancel, { once: true });
    if (input.signal.aborted) cancel();
    try {
      const result = await process.closed;
      return {
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        exitCode: result.exitCode,
      };
    } finally {
      input.signal.removeEventListener("abort", cancel);
    }
  }

  async reattach(ref: string): Promise<BackgroundProcess | null> {
    // Native handles cannot be reconstructed after restart; core records those processes as lost.
    return this.active.get(ref) ?? null;
  }
}
