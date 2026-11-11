import { sandbox } from "@nervekit/native";
import type { QuickScriptHostCall } from "@nervekit/contracts/tools";
import type { ToolExecutionResult } from "../execution-context.js";
import type {
  ArtifactReport,
  QuickScriptContext,
  PageReport,
  SdkEnvironment,
} from "./sdk-types.js";
import { ToolExecutionError } from "../errors/tool-error.js";
import { hostErrorCode } from "./errors.js";
import { processFooter } from "../../result-projection/process-footer.js";
import { withImageSizes } from "./files/artifacts.js";
import { assertDeclaredRisk } from "./script-risk.js";
import {
  createSdkEnvironment,
  findSdkMethod,
  preludesFor,
  sdkMethodNames,
  wrapScript,
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
 * Jira and Confluence SDKs. Failure convention follows `python_exec`: a script that fails,
 * times out or is cancelled still yields a normal result (error text + footer,
 * non-zero `exitCode`); only invalid arguments and a missing runtime throw.
 */
export async function executeQuickScript(
  args: Record<string, unknown>,
  context: QuickScriptContext,
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

  // Cancelling the tool call or a 401 ends the whole script: `stop` aborts the
  // run and every in-flight host call, because the SDK methods read their
  // signal from the environment's context.
  const stop = new AbortController();
  const abortStop = () => stop.abort();
  context.signal?.addEventListener("abort", abortStop, { once: true });
  if (context.signal?.aborted) stop.abort();
  const env = createSdkEnvironment({ ...context, signal: stop.signal });
  const hostCalls: QuickScriptHostCall[] = [];
  let authFailure: string | undefined;

  const outcome = await sandbox
    .runSandboxScript({
      code: wrapScript(code),
      typescript: true,
      preludes: preludesFor(code),
      timeoutMs: clampTimeoutSeconds(args.timeout) * 1000,
      signal: stop.signal,
      onHostCall: async (method, rawArgs) => {
        const started = performance.now();
        const record = (
          fields: Pick<QuickScriptHostCall, "outcome"> &
            Partial<QuickScriptHostCall>,
        ) =>
          hostCalls.push({
            method,
            ...fields,
            durationMs: Math.round(performance.now() - started),
          });
        if (authFailure) {
          record({ outcome: "failed", error: authFailure });
          throw new Error(`[UNAUTHORIZED] ${authFailure}`);
        }
        const sdkMethod = findSdkMethod(method);
        if (!sdkMethod) {
          const message = `Unknown method '${method}'. Valid methods: ${sdkMethodNames().join(", ")}.`;
          record({ outcome: "failed", error: message });
          throw new Error(`[BAD_REQUEST] ${message}`);
        }
        const callArgs = Array.isArray(rawArgs) ? rawArgs : [];
        let prepared;
        try {
          prepared = sdkMethod.prepare(callArgs, env);
        } catch (error) {
          record({ outcome: "failed", error: cleanMessage(error) });
          throw hostFailure(error);
        }
        const checks = [
          ...(prepared.authorization ? [prepared.authorization] : []),
          ...(prepared.additionalAuthorizations ?? []),
        ];
        try {
          assertDeclaredRisk(method, sdkMethod.risk, checks);
        } catch (error) {
          record({ outcome: "failed", error: cleanMessage(error) });
          throw hostFailure(error);
        }
        const base = {
          authorizedAs: checks[0]?.toolName,
          summary: truncate(
            prepared.authorization?.summary ?? prepared.resource,
            200,
          ),
        };
        try {
          if (checks.length > 0 && !context.authorizeNested) {
            throw new Error(
              "Nested authorization is unavailable; refusing to run SDK calls.",
            );
          }
          for (const request of checks) {
            await context.authorizeNested!({
              toolName: request.toolName,
              args: request.args,
              ...(request.approvalRequired ? { approvalRequired: true } : {}),
            });
          }
        } catch (error) {
          record({ ...base, outcome: "denied", error: cleanMessage(error) });
          throw hostFailure(error);
        }
        try {
          const value = await prepared.run(env);
          record({ ...base, outcome: "completed" });
          return value;
        } catch (error) {
          const unauthorized = await unauthorizedMessage(error, env);
          if (unauthorized) {
            authFailure ??= unauthorized;
            record({ ...base, outcome: "failed", error: unauthorized });
            stop.abort();
            throw new Error(`[UNAUTHORIZED] ${unauthorized}`, { cause: error });
          }
          record({
            ...base,
            outcome: "failed",
            error: failureMessage(error, prepared.resource),
          });
          throw hostFailure(error, prepared.resource);
        }
      },
    })
    .finally(() => context.signal?.removeEventListener("abort", abortStop));

  const status = authFailure ? "failed" : outcome.status;
  const error =
    authFailure ??
    (outcome.error ? scriptError(outcome.error, code) : undefined);
  const exitCode = EXIT_CODES[status] ?? 1;
  const artifacts = await withImageSizes([...env.report.artifacts.values()]);
  const footer = quickScriptFooter({
    hostCalls,
    status,
    exitCode,
    durationMs: outcome.durationMs,
  });
  const content = [
    outcome.output.trimEnd(),
    outcome.outputTruncated ? "[output truncated]" : undefined,
    error,
    ...reportLines(env.report.pages, artifacts, env.report.created),
    footer,
  ]
    .filter((part): part is string => Boolean(part))
    .join("\n");

  return {
    content,
    exitCode,
    details: {
      status,
      ...(error ? { error } : {}),
      durationMs: Math.round(outcome.durationMs),
      memoryUsedBytes: outcome.memoryUsedBytes,
      outputTruncated: outcome.outputTruncated,
      hostCalls,
      pages: env.report.pages,
      created: env.report.created,
      artifacts,
      // Content already carries the footer; the script_output projection must not add another.
      processStatusIncluded: true,
    },
  };
}

/** Lint report for every page written and the artifacts created, appended after the script's output. */
export function reportLines(
  pages: readonly PageReport[],
  artifacts: readonly ArtifactReport[],
  created: readonly string[],
): string[] {
  const lines = pages.map((page) => {
    const parts = [
      `Page ${page.id} "${page.title}" ${page.action}${page.version ? ` (v${page.version})` : ""}`,
    ];
    if (page.fixes.length > 0) parts.push(`fixes: ${page.fixes.join("; ")}`);
    if (page.warnings.length > 0) {
      parts.push(`warnings: ${page.warnings.join("; ")}`);
    }
    if (page.fixes.length + page.warnings.length === 0)
      parts.push("lint clean");
    return parts.join(" · ");
  });
  if (artifacts.length > 0) {
    lines.push(
      `Artifacts: ${artifacts.map((file) => `${file.handle} (${formatBytes(file.bytes)})`).join(", ")}`,
    );
  }
  if (created.length > 0) {
    const shown = created.slice(0, MAX_CREATED_LISTED).join(", ");
    const more = created.length - MAX_CREATED_LISTED;
    lines.push(`Created: ${shown}${more > 0 ? `, +${more} more` : ""}`);
  }
  return lines;
}

const MAX_CREATED_LISTED = 20;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** `jira 3 calls (issues.search 1, issues.get 2) · confluence 1 call (pages.get 1) · exit 0 · 1.2s`. */
export function quickScriptFooter(input: {
  hostCalls: readonly QuickScriptHostCall[];
  status: string;
  exitCode: number;
  durationMs: number;
}): string {
  const parts: string[] = [];
  const byProduct = new Map<string, Map<string, number>>();
  for (const call of input.hostCalls) {
    const [product = "sdk", ...rest] = call.method.split(".");
    const counts = byProduct.get(product) ?? new Map<string, number>();
    const name = rest.join(".") || call.method;
    counts.set(name, (counts.get(name) ?? 0) + 1);
    byProduct.set(product, counts);
  }
  for (const [product, counts] of byProduct) {
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const breakdown = [...counts].map(([name, n]) => `${name} ${n}`).join(", ");
    parts.push(
      `${product} ${total} call${total === 1 ? "" : "s"} (${breakdown})`,
    );
  }
  const denied = input.hostCalls.filter(
    (call) => call.outcome === "denied",
  ).length;
  if (denied > 0) parts.push(`${denied} denied`);
  if (input.status === "failed") parts.push("failed");
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

/**
 * Keeps the message and the stack frames that belong to the script: SDK/prelude
 * frames and the wrapper's closing line (the line after the script's last) are dropped.
 */
function scriptError(raw: string, code: string): string {
  const lastLine = code.split("\n").length;
  return raw
    .split("\n")
    .filter((line) => {
      if (/nerve:/.test(line)) return false;
      const frame = /script\.ts:(\d+):\d+/.exec(line);
      return !frame || Number(frame[1]) <= lastLine;
    })
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

/** Jira/Confluence errors end with a pointer to a skill guide; quick_script has no such guide. */
const GUIDE_POINTER = /\s+See \S*SKILL\.md\.?\s*$/;

function cleanMessage(error: unknown): string {
  return messageOf(error).replace(GUIDE_POINTER, "");
}

/** A 403 names the resource ("no access to project APP"); other messages pass through. */
function failureMessage(error: unknown, resource?: string): string {
  return hostErrorCode(error) === "FORBIDDEN" && resource
    ? `no access to ${resource}`
    : cleanMessage(error);
}

/** Script-side errors carry their code as a "[CODE] " prefix that the prelude turns into `error.code`. */
function hostFailure(error: unknown, resource?: string): Error {
  return new Error(
    `[${hostErrorCode(error)}] ${failureMessage(error, resource)}`,
  );
}

/** For a 401, the message that ends the whole script; otherwise undefined. */
async function unauthorizedMessage(
  error: unknown,
  env: SdkEnvironment,
): Promise<string | undefined> {
  if (!(error instanceof ToolExecutionError)) return undefined;
  const product = /^(JIRA|CONFLUENCE)_UNAUTHORIZED$/.exec(error.code)?.[1];
  if (!product) return undefined;
  const connection = await (
    product === "JIRA" ? env.jira() : env.confluence()
  ).catch(() => undefined);
  const name = product === "JIRA" ? "Jira" : "Confluence";
  return `${name} rejected the API token${connection ? ` for ${connection.email}` : ""}; update it in Settings → Integrations.`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
