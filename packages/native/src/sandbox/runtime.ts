import { binding } from "../binding/loader.js";
import type {
  NativeSandboxBinding,
  NativeSandboxRuntimeEvent,
} from "./binding.js";
import { PERSISTENT_PRELUDE } from "./prelude.js";

const native = binding as typeof binding & NativeSandboxBinding;

export interface SandboxLimits {
  /** Memory for the runtime's whole lifetime. Default 256 MiB. */
  memoryBytes?: number;
  /** Per invocation, armed when it starts; idle time never counts. Default 120 s. */
  timeMsPerInvocation?: number;
  /** Counted host calls per invocation. Default 200. */
  hostCallsPerInvocation?: number;
  /** Largest accepted invocation result, in JSON bytes. Default 256 KiB. */
  outputBytes?: number;
  /** QuickJS stack size. Default 1 MiB. */
  stackBytes?: number;
}

export interface OpenSandboxOptions {
  /** Classic scripts evaluated once, in order; they define the globals that `invoke` calls. */
  preludes: string[];
  limits?: SandboxLimits;
  /**
   * Answers `host.call(method, args, invocation)` from the runtime with a JSON
   * string. A rejection rejects the call in the runtime with the error message.
   * `invocationId` is the invocation the call belongs to.
   */
  onHostCall: (
    method: string,
    argsJson: string,
    invocationId: number,
  ) => Promise<string>;
  /** Host methods that never count toward `hostCallsPerInvocation` (fire-and-forget calls). */
  uncountedHostMethods?: string[];
}

export type SandboxInvocationStatus =
  | "failed"
  | "timed_out"
  | "cancelled"
  | "memory_limit"
  | "disposed";

/** Why an invocation did not produce a value. `message` is the thrown error message for "failed". */
export class SandboxInvocationError extends Error {
  constructor(
    message: string,
    readonly status: SandboxInvocationStatus,
  ) {
    super(message);
    this.name = "SandboxInvocationError";
  }
}

export interface SandboxHandle {
  /**
   * Calls the global function `fn` as `fn(JSON.parse(argsJson), invocationId)`,
   * awaits its result and resolves its JSON. Invocations may run concurrently
   * (interleaved on the runtime thread). Pass `invocationId` to the runtime's
   * `host.call` so host calls count against the right invocation.
   */
  invoke(fn: string, argsJson: string): Promise<string>;
  /** Cancels one invocation by id (as given to `onHostCall`), or all of them. */
  cancel(invocationId?: number): void;
  /** Ends the runtime; pending invocations reject with status "disposed". */
  dispose(): void;
}

export function isPersistentAvailable(): boolean {
  return typeof native.openSandboxRuntime === "function";
}

/**
 * Opens a persistent QuickJS runtime on its own thread and evaluates the
 * preludes once (rejects if one throws). An idle runtime is fine; it lives
 * until `dispose`. If the memory limit is exceeded the runtime closes and later
 * invocations reject.
 */
export async function openSandbox(
  options: OpenSandboxOptions,
): Promise<SandboxHandle> {
  if (typeof native.openSandboxRuntime !== "function") {
    throw new Error("Native sandbox support is not available");
  }
  const limits = options.limits ?? {};
  const timeMs = limits.timeMsPerInvocation ?? 120_000;
  const pending = new Map<
    number,
    { resolve: (json: string) => void; reject: (error: Error) => void }
  >();
  let nextInvocation = 1;
  let closed: string | undefined;
  let onReady: ((error: string | undefined) => void) | undefined;

  const closeWith = (reason: string, status: SandboxInvocationStatus) => {
    closed ??= reason;
    for (const waiter of pending.values()) {
      waiter.reject(new SandboxInvocationError(reason, status));
    }
    pending.clear();
  };

  const onEvent = (error: Error | null, event: NativeSandboxRuntimeEvent) => {
    if (error) {
      // A lost event could leave invocations waiting forever.
      runtime.dispose();
      closeWith(`Sandbox event transport failed: ${error.message}`, "failed");
      return;
    }
    switch (event.kind) {
      case "ready":
        onReady?.(event.value ?? undefined);
        onReady = undefined;
        return;
      case "host_call": {
        const { id, method, invocation } = event;
        if (id == null || method == null || invocation == null) return;
        options.onHostCall(method, event.args ?? "null", invocation).then(
          (json) => runtime.reply(id, true, json),
          (failure: unknown) =>
            runtime.reply(
              id,
              false,
              failure instanceof Error ? failure.message : String(failure),
            ),
        );
        return;
      }
      case "settled": {
        const waiter =
          event.invocation == null ? undefined : pending.get(event.invocation);
        if (!waiter || event.invocation == null) return;
        pending.delete(event.invocation);
        const value = event.value ?? "";
        switch (event.status) {
          case "completed":
            return waiter.resolve(value);
          case "timed_out":
            return waiter.reject(
              new SandboxInvocationError(
                `Invocation exceeded ${timeMs} ms`,
                "timed_out",
              ),
            );
          case "cancelled":
            return waiter.reject(
              new SandboxInvocationError("Invocation cancelled", "cancelled"),
            );
          case "memory_limit":
            // The runtime closes right after; reject new invocations before its event arrives.
            closed ??= "memory limit exceeded";
            return waiter.reject(
              new SandboxInvocationError(
                "Sandbox exceeded its memory limit",
                "memory_limit",
              ),
            );
          case "disposed":
            return waiter.reject(
              new SandboxInvocationError("Sandbox disposed", "disposed"),
            );
          default:
            return waiter.reject(new SandboxInvocationError(value, "failed"));
        }
      }
      case "closed":
        closeWith(
          event.value ?? "Sandbox closed",
          event.value ? "failed" : "disposed",
        );
        return;
    }
  };

  const ready = new Promise<string | undefined>((resolve) => {
    onReady = resolve;
  });
  const runtime = native.openSandboxRuntime(
    {
      preludes: [
        { name: "nerve:base", source: PERSISTENT_PRELUDE },
        ...options.preludes.map((source, index) => ({
          name: `prelude-${index}.js`,
          source,
        })),
      ],
      memoryBytes: limits.memoryBytes ?? 256 * 1024 * 1024,
      timeMsPerInvocation: timeMs,
      hostCallsPerInvocation: limits.hostCallsPerInvocation ?? 200,
      uncountedHostMethods: options.uncountedHostMethods,
      outputBytes: limits.outputBytes ?? 256 * 1024,
      stackBytes: limits.stackBytes ?? 1024 * 1024,
    },
    onEvent,
  );
  const failure = await ready;
  if (failure !== undefined) {
    runtime.dispose();
    throw new Error(failure);
  }

  return {
    invoke(fn, argsJson) {
      if (closed !== undefined) {
        return Promise.reject(
          new SandboxInvocationError(
            `Sandbox runtime is unusable: ${closed}`,
            "failed",
          ),
        );
      }
      const id = nextInvocation++;
      return new Promise<string>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        if (!runtime.invoke(id, fn, argsJson)) {
          pending.delete(id);
          reject(
            new SandboxInvocationError(
              "Sandbox runtime is unusable: closed",
              "failed",
            ),
          );
        }
      });
    },
    cancel(invocationId) {
      runtime.cancel(invocationId ?? null);
    },
    dispose() {
      if (closed === undefined) runtime.dispose();
      closeWith("Sandbox disposed", "disposed");
    },
  };
}
