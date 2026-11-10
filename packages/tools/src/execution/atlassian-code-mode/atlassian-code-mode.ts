import { sandbox } from "@nervekit/native";
import type { CodeModeHostCall } from "@nervekit/contracts/tools";
import type {
  IntegrationExecutionContext,
  ToolExecutionResult,
} from "../execution-context.js";
import { processFooter } from "../../result-projection/process-footer.js";
import {
  createSdkEnvironment,
  findSdkMethod,
  SDK_PRELUDE,
  sdkMethodNames,
} from "./sdk.js";

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;
export const MAX_CODE_CHARS = 100_000;

const EXIT_CODES: Record<string, number> = {
  completed: 0,
  failed: 1,
  timed_out: 124,
  cancelled: 130,
  memory_limit: 137,
};

/**
 * Runs an agent-written TypeScript script in the QuickJS sandbox with the
 * Jira SDK. Failure convention follows `python_exec`: a script that fails,
 * times out or is cancelled still yields a normal result (error text + footer,
 * non-zero `exitCode`); only invalid arguments and a missing runtime throw.
 */
export async function executeAtlassianCodeMode(
  args: Record<string, unknown>,
  context: IntegrationExecutionContext,
): Promise<ToolExecutionResult> {
  const code = typeof args.code === "string" ? args.code : "";
  if (code.trim().length === 0) {
    throw new Error("Tool argument 'code' must be a non-empty string.");
  }
  if (code.length > MAX_CODE_CHARS) {
    throw new Error(
      `Tool argument 'code' is too long (${code.length} chars; max ${MAX_CODE_CHARS}).`,
    );
  }
  if (!sandbox.isAvailable()) {
    throw new Error("The code sandbox is not available in this build.");
  }

  const env = createSdkEnvironment(context);
  const hostCalls: CodeModeHostCall[] = [];

  const outcome = await sandbox.runSandboxScript({
    code,
    typescript: true,
    preludes: [{ name: "nerve:atlassian-sdk", source: SDK_PRELUDE }],
    timeoutMs: clampTimeoutSeconds(args.timeout) * 1000,
    signal: context.signal,
    onHostCall: async (method, rawArgs) => {
      const started = performance.now();
      const record = (
        fields: Pick<CodeModeHostCall, "outcome"> & Partial<CodeModeHostCall>,
      ) =>
        hostCalls.push({
          method,
          ...fields,
          durationMs: Math.round(performance.now() - started),
        });
      const sdkMethod = findSdkMethod(method);
      if (!sdkMethod) {
        const message = `Unknown method '${method}'. Valid methods: ${sdkMethodNames().join(", ")}.`;
        record({ outcome: "failed", error: message });
        throw new Error(message);
      }
      const callArgs = Array.isArray(rawArgs) ? rawArgs : [];
      let authorization;
      try {
        authorization = sdkMethod.authorize(callArgs);
      } catch (error) {
        record({ outcome: "failed", error: messageOf(error) });
        throw error;
      }
      const base = {
        authorizedAs: authorization.toolName,
        summary: truncate(authorization.summary, 200),
      };
      try {
        if (!context.authorizeNested) {
          throw new Error(
            "Nested authorization is unavailable; refusing to run SDK calls.",
          );
        }
        await context.authorizeNested({
          toolName: authorization.toolName,
          args: authorization.args,
        });
      } catch (error) {
        record({ ...base, outcome: "denied", error: messageOf(error) });
        throw error;
      }
      try {
        const value = await sdkMethod.run(callArgs, env);
        record({ ...base, outcome: "completed" });
        return value;
      } catch (error) {
        record({ ...base, outcome: "failed", error: messageOf(error) });
        throw error;
      }
    },
  });

  const error = outcome.error ? scriptError(outcome.error) : undefined;
  const exitCode = EXIT_CODES[outcome.status] ?? 1;
  const footer = codeModeFooter({
    hostCalls,
    status: outcome.status,
    error,
    exitCode,
    durationMs: outcome.durationMs,
  });
  const content = [
    outcome.output.trimEnd(),
    outcome.outputTruncated ? "[output truncated]" : undefined,
    error,
    footer,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");

  return {
    content,
    exitCode,
    details: {
      status: outcome.status,
      ...(error ? { error } : {}),
      durationMs: Math.round(outcome.durationMs),
      memoryUsedBytes: outcome.memoryUsedBytes,
      outputTruncated: outcome.outputTruncated,
      hostCalls,
      // Content already carries the footer; the script_output projection must not add another.
      processStatusIncluded: true,
    },
  };
}

/** `jira 3 calls (issues.search 1, issues.get 2) · exit 0 · 1.2s`. */
export function codeModeFooter(input: {
  hostCalls: readonly CodeModeHostCall[];
  status: string;
  error?: string;
  exitCode: number;
  durationMs: number;
}): string {
  const parts: string[] = [];
  if (input.hostCalls.length > 0) {
    const counts = new Map<string, number>();
    for (const call of input.hostCalls) {
      const name = call.method.replace(/^jira\./, "");
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const total = input.hostCalls.length;
    const breakdown = [...counts].map(([name, n]) => `${name} ${n}`).join(", ");
    parts.push(`jira ${total} call${total === 1 ? "" : "s"} (${breakdown})`);
    const denied = input.hostCalls.filter(
      (call) => call.outcome === "denied",
    ).length;
    if (denied > 0) parts.push(`${denied} denied`);
  }
  if (input.status === "failed") {
    const first = (input.error ?? "error").split("\n")[0];
    parts.push(`failed: ${truncate(first, 200)}`);
  }
  parts.push(
    processFooter({
      exitCode: input.exitCode,
      status: ["cancelled", "memory_limit"].includes(input.status)
        ? input.status.replace("_", " ")
        : undefined,
      timedOut: input.status === "timed_out",
      durationMs: input.durationMs,
    }),
  );
  return parts.join(" · ");
}

/** Keeps the message and the stack frames that belong to the script (drops SDK/prelude frames). */
function scriptError(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !/nerve:/.test(line))
    .join("\n")
    .trim();
}

function clampTimeoutSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_SECONDS;
  }
  return Math.min(Math.floor(value) || 1, MAX_TIMEOUT_SECONDS);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
