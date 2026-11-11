import { stripTypeScriptTypes } from "node:module";
import { binding } from "../binding/loader.js";
import type { NativeSandboxBinding, NativeSandboxOutcome } from "./binding.js";
import { BASE_PRELUDE } from "./prelude.js";

/** Time the engine thread gets past the script timeout to report its exit. */
const EXIT_GRACE_MS = 5_000;

const native = binding as typeof binding & NativeSandboxBinding;

export type SandboxStatus = NativeSandboxOutcome["status"];

export interface SandboxHostCallRecord {
  method: string;
  ok: boolean;
  durationMs: number;
}

export interface SandboxOutcome {
  status: SandboxStatus;
  error?: string;
  output: string;
  outputTruncated: boolean;
  hostCalls: SandboxHostCallRecord[];
  durationMs: number;
  memoryUsedBytes: number;
}

export interface RunSandboxScriptOptions {
  code: string;
  /** Strip TypeScript types first (Node's `stripTypeScriptTypes`). */
  typescript?: boolean;
  /** Trusted classic scripts evaluated before the module, in order. */
  preludes?: Array<{ name: string; source: string }>;
  timeoutMs?: number;
  memoryBytes?: number;
  maxHostCalls?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  /**
   * Handles `host.call(method, args)` from the script. Policy (permissions,
   * approvals) belongs here. A throw rejects the script's promise with the
   * error message.
   */
  onHostCall: (method: string, args: unknown) => Promise<unknown>;
}

/** True when the loaded addon includes the sandbox domain. */
export function isAvailable(): boolean {
  return typeof native.startSandboxScript === "function";
}

/**
 * Runs an ES module (top-level await allowed) in a fresh QuickJS runtime on a
 * native thread. The script has no I/O except `console.*` and `host.call`.
 */
export async function runSandboxScript(
  options: RunSandboxScriptOptions,
): Promise<SandboxOutcome> {
  if (typeof native.startSandboxScript !== "function") {
    throw new Error("Native sandbox support is not available");
  }
  let code = options.code;
  if (options.typescript) {
    try {
      code = stripTypeScriptTypes(code, { mode: "strip" });
    } catch (error) {
      return failedBeforeStart(error);
    }
  }
  options.signal?.throwIfAborted();

  const records: SandboxHostCallRecord[] = [];
  return await new Promise<SandboxOutcome>((resolve, reject) => {
    let script: ReturnType<NonNullable<typeof native.startSandboxScript>>;
    let hostFailure: string | undefined;
    let settled = false;
    const onAbort = () => script?.cancel();
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      options.signal?.removeEventListener("abort", onAbort);
      settle();
    };
    // The engine thread enforces the timeout itself; this only fires when its
    // exit never arrives (a crashed thread), so the caller cannot hang.
    const watchdog = setTimeout(
      () => {
        script?.cancel();
        finish(() =>
          resolve(failed("The sandbox did not exit after its deadline")),
        );
      },
      (options.timeoutMs ?? 120_000) + EXIT_GRACE_MS,
    );
    watchdog.unref();
    try {
      script = native.startSandboxScript!(
        {
          name: options.typescript ? "script.ts" : "script.js",
          code,
          preludes: [
            { name: "nerve:base", source: BASE_PRELUDE },
            ...(options.preludes ?? []),
          ],
          memoryBytes: options.memoryBytes ?? 256 * 1024 * 1024,
          timeoutMs: options.timeoutMs ?? 120_000,
          maxHostCalls: options.maxHostCalls ?? 200,
          maxOutputBytes: options.maxOutputBytes ?? 256 * 1024,
        },
        (error, call) => {
          if (error) {
            // A lost request would leave the script waiting for a reply until the timeout.
            hostFailure ??= errorText(error);
            script?.cancel();
            return;
          }
          const started = performance.now();
          void handle(call.method, call.args).then(
            (value) => {
              records.push({
                method: call.method,
                ok: true,
                durationMs: performance.now() - started,
              });
              script.reply(call.id, true, JSON.stringify(value ?? null));
            },
            (failure: unknown) => {
              records.push({
                method: call.method,
                ok: false,
                durationMs: performance.now() - started,
              });
              script.reply(call.id, false, errorText(failure));
            },
          );
        },
        (error, outcome) => {
          if (error) return finish(() => reject(error));
          if (hostFailure) {
            const message = `Host call transport failed: ${hostFailure}`;
            return finish(() =>
              resolve({ ...failed(message), hostCalls: records }),
            );
          }
          finish(() =>
            resolve({
              status: outcome.status,
              ...(outcome.error ? { error: outcome.error } : {}),
              output: outcome.output,
              outputTruncated: outcome.outputTruncated,
              hostCalls: records,
              durationMs: outcome.durationMs,
              memoryUsedBytes: outcome.memoryUsedBytes,
            }),
          );
        },
      );
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
  });

  async function handle(method: string, args: string): Promise<unknown> {
    return await options.onHostCall(method, JSON.parse(args) as unknown);
  }
}

function failedBeforeStart(error: unknown): SandboxOutcome {
  return failed(errorText(error));
}

function failed(error: string): SandboxOutcome {
  return {
    status: "failed",
    error,
    output: "",
    outputTruncated: false,
    hostCalls: [],
    durationMs: 0,
    memoryUsedBytes: 0,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
