import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  spawnShellProcess,
  stopProcessTree,
  waitForProcessExit,
} from "../infrastructure/process-host/shell-process.js";
import {
  captureProcessOutput,
  PROCESS_OUTPUT_LIMIT_BYTES,
} from "../infrastructure/process-host/output-capture.js";
import { waitForOutputReadiness } from "../infrastructure/process-host/readiness.js";
import type {
  BackgroundProcess,
  ProcessPort,
} from "@nervekit/conversation-core";

export class CoreProcessHost implements ProcessPort {
  private readonly active = new Map<string, BackgroundProcess>();
  constructor(
    private readonly shellPath:
      | string
      | ((
          cwd: string,
        ) => string | undefined | Promise<string | undefined>) = () =>
      undefined,
  ) {}

  private resolveShellPath(cwd: string) {
    return typeof this.shellPath === "function"
      ? this.shellPath(cwd)
      : this.shellPath;
  }

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
      combined: join(input.artifactDir, "output.txt"),
    };
    const { managed: process } = spawnShellProcess(input.command, {
      shellPath: await this.resolveShellPath(input.cwd),
      login: true,
      cwd: input.cwd,
      env: input.env,
      policy: {
        wallTimeMs: input.timeoutMs,
        output: {
          totalBytes: PROCESS_OUTPUT_LIMIT_BYTES,
          overflow: "truncate",
        },
      },
    });
    let cancelled = false;
    let exited = false;
    void process.exited.then(() => {
      exited = true;
    });
    const drains = captureProcessOutput(process, outputFiles, input.onProgress);
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
        const evidence = await stopProcessTree({
          signalProcess: async (signal) => {
            const result = await process.terminate(signal);
            if (!result.terminated)
              throw new Error(
                result.error ?? "Process termination could not be confirmed",
              );
          },
          waitForExit: () => waitForProcessExit(process.exited, 5_000),
        });
        if (evidence === "timeout")
          throw new Error("Process termination could not be confirmed");
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
      return {
        process: background,
        readiness: await waitForOutputReadiness(background, {
          signal: input.signal,
          ready: input.ready,
        }),
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
    const { managed: process } = spawnShellProcess(input.command, {
      shellPath: await this.resolveShellPath(input.cwd),
      login: true,
      cwd: input.cwd,
      policy: { output: { totalBytes: 1024 * 1024, overflow: "truncate" } },
    });
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
