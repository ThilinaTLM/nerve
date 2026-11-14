import { dirname, join } from "node:path";
import { sandbox } from "@nervekit/native";
import type { QuickScriptHostCall } from "@nervekit/contracts/tools";
import type { ToolExecutionResult } from "../../execution/index.js";
import type {
  SdkMethod,
  ArtifactReport,
  QuickScriptContext,
  PageReport,
  SdkEnvironment,
} from "./sdk-types.js";
import { isOperationCheck } from "./sdk-types.js";
import { ToolExecutionError } from "../../execution/index.js";
import { type DisplayPaths, errnoMessage, hostErrorCode } from "./errors.js";
import { processFooter } from "../../result-projection/index.js";
import { withImageSizes } from "./files/artifacts.js";
import { assertDeclaredRisk } from "./script-risk.js";
import { declarationLine } from "./sdk-dts.js";
import { quickScriptRegistry } from "../registry.js";
import {
  createSdkEnvironment,
  findSdkMethod,
  preludesFor,
  sdkMethodNames,
  wrapScript,
} from "./sdk.js";

const DEFAULT_TIMEOUT_SECONDS = 120;
/** How long calls aborted at the end of a run get to settle before the result is built. */
const SETTLE_GRACE_MS = 3000;
const MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;
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
  const registry = context.registry ?? quickScriptRegistry();
  const env = createSdkEnvironment({
    ...context,
    registry,
    signal: stop.signal,
  });
  const hostCalls: QuickScriptHostCall[] = [];
  const paths: DisplayPaths = {
    cwd: context.cwd,
    artifactDir: context.conversationDir
      ? join(context.conversationDir, "quick-script")
      : undefined,
  };
  let authFailure: string | undefined;
  // Calls still running when the script ends are aborted and settled before the
  // result is built, so nothing mutates the report afterwards.
  const pending = new Set<Promise<void>>();
  let sealed = false;

  const outcome = await sandbox
    .runSandboxScript({
      code: wrapScript(code),
      typescript: true,
      preludes: preludesFor(code, registry),
      timeoutMs: clampTimeoutSeconds(args.timeout) * 1000,
      signal: stop.signal,
      onHostCall: (method, rawArgs) => {
        const call = hostCall(method, rawArgs);
        const settled: Promise<void> = call
          .then(
            () => undefined,
            () => undefined,
          )
          .finally(() => pending.delete(settled));
        pending.add(settled);
        return call;
      },
    })
    .finally(() => context.signal?.removeEventListener("abort", abortStop));

  async function hostCall(method: string, rawArgs: unknown): Promise<unknown> {
    const started = performance.now();
    if (sealed) throw new Error("[BAD_REQUEST] the script has finished");
    const record = (
      fields: Pick<QuickScriptHostCall, "outcome"> &
        Partial<QuickScriptHostCall>,
    ) => {
      if (!sealed)
        hostCalls.push({
          method,
          ...fields,
          durationMs: Math.round(performance.now() - started),
        });
    };
    if (authFailure) {
      record({ outcome: "failed", error: authFailure });
      throw new Error(`[UNAUTHORIZED] ${authFailure}`);
    }
    const sdkMethod = findSdkMethod(method, registry);
    if (!sdkMethod) {
      const message = `Unknown method '${method}'. Valid methods: ${sdkMethodNames(registry).join(", ")}.`;
      record({ outcome: "failed", error: message });
      throw new Error(`[BAD_REQUEST] ${message}`);
    }
    const callArgs = Array.isArray(rawArgs) ? rawArgs : [];
    let prepared;
    try {
      prepared = sdkMethod.prepare(callArgs, env);
    } catch (error) {
      const taught = withDeclaration(error, sdkMethod);
      record({ outcome: "failed", error: cleanMessage(taught, paths) });
      throw hostFailure(taught, undefined, paths);
    }
    const checks = [
      ...(prepared.authorization ? [prepared.authorization] : []),
      ...(prepared.additionalAuthorizations ?? []),
    ];
    try {
      assertDeclaredRisk(method, sdkMethod.risk, checks);
    } catch (error) {
      record({ outcome: "failed", error: cleanMessage(error, paths) });
      throw hostFailure(error, undefined, paths);
    }
    const operationTargets = checks
      .filter(isOperationCheck)
      .flatMap((check) => check.targets.map((target) => target.value));
    const base = {
      ...(checks[0] && !isOperationCheck(checks[0])
        ? { authorizedAs: checks[0].toolName }
        : {}),
      ...(operationTargets.length > 0 ? { targets: operationTargets } : {}),
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
        await context.authorizeNested!(
          isOperationCheck(request)
            ? {
                operation: request.operation,
                targets: request.targets.map((target) => target.value),
                risk: request.risk,
              }
            : { toolName: request.toolName, args: request.args },
        );
      }
    } catch (error) {
      record({ ...base, outcome: "denied", error: cleanMessage(error, paths) });
      throw hostFailure(error, undefined, paths);
    }
    try {
      const value = await prepared.run(env);
      // A raw non-GET request cannot be analysed; the footer names what was sent.
      if (
        sdkMethod.path === "request" &&
        prepared.authorization &&
        isOperationCheck(prepared.authorization) &&
        prepared.authorization.risk === "destructive" &&
        !sealed
      )
        env.report.raw.push(prepared.authorization.summary);
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
        error: failureMessage(error, prepared.resource, paths),
      });
      throw hostFailure(error, prepared.resource, paths);
    }
  }

  // Stop whatever the script left running, and let it settle (bounded) before reading the report.
  stop.abort();
  let graceTimer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled([...pending]),
    new Promise((resolve) => {
      graceTimer = setTimeout(resolve, SETTLE_GRACE_MS);
    }),
  ]);
  clearTimeout(graceTimer);
  sealed = true;

  // QuickJS reports some out-of-memory failures as a bare `null` exception (the engine could not even allocate an Error).
  const memoryExceeded =
    outcome.status === "failed" &&
    /^(?:null)?$/.test(outcome.error?.trim() ?? "");
  const status = authFailure
    ? "failed"
    : memoryExceeded
      ? "memory_limit"
      : outcome.status;
  const error =
    authFailure ??
    (memoryExceeded
      ? `script exceeded the ${MEMORY_LIMIT_BYTES / (1024 * 1024)} MiB memory limit`
      : outcome.error
        ? scriptError(outcome.error, code)
        : undefined);
  const exitCode = EXIT_CODES[status] ?? 1;
  // Copies: a call that ignored the abort must not change a result already built.
  const report = reconcileReport(
    {
      created: env.report.created,
      updated: env.report.updated,
      deleted: env.report.deleted,
      raw: env.report.raw,
    },
    env.report.pages
      .filter((page) => page.action === "created")
      .map((page) => page.id),
  );
  const pages = env.report.pages.map((page) => ({ ...page }));
  const artifacts = await withImageSizes([...env.report.artifacts.values()]);
  const calls = hostCalls.map((call) => ({ ...call }));
  const footer = quickScriptFooter({
    hostCalls: calls,
    status,
    exitCode,
    durationMs: outcome.durationMs,
  });
  const content = [
    outcome.output.trimEnd(),
    outcome.outputTruncated ? "[output truncated]" : undefined,
    error,
    ...reportLines(pages, artifacts, report, env.report.notes),
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
      hostCalls: calls,
      pages,
      created: report.created,
      ...(report.updated.length > 0 ? { updated: report.updated } : {}),
      ...(report.deleted.length > 0 ? { deleted: report.deleted } : {}),
      ...(report.raw.length > 0 ? { raw: report.raw } : {}),
      artifacts,
      // Content already carries the footer; the script_output projection must not add another.
      processStatusIncluded: true,
    },
  };
}

/** A wrong-argument error ends with the method's declaration, so the call can be fixed without a `sdk.describe`. */
function withDeclaration(error: unknown, method: SdkMethod): unknown {
  if (!(error instanceof Error) || error instanceof ToolExecutionError)
    return error;
  return Object.assign(
    new Error(`${error.message} Declaration: ${declarationLine(method)}`, {
      cause: error,
    }),
    (error as { code?: unknown }).code === undefined
      ? {}
      : { code: (error as { code?: unknown }).code },
  );
}

/** What the run changed, as listed in the footer. */
export type ChangeReport = {
  created: string[];
  updated: string[];
  deleted: string[];
  /** Raw non-GET requests: `POST /rest/api/3/issue`. */
  raw: string[];
};

/** An entity created and deleted in one run is shown as deleted (marked), not as created; one created and updated is just created. */
export function reconcileReport(
  report: ChangeReport,
  /** Ids of pages created in this run; they are listed as `Page … created` lines, not in `created`. */
  createdPageIds: readonly string[] = [],
): ChangeReport {
  // `attachment 10 on SCRUM-1` and `attachment 10` name one entity; so do `page 5 "T" (trashed)` and `page 5`.
  const entity = (item: string) =>
    /^(?:attachment|page) \S+/.exec(item)?.[0] ?? item;
  const created = new Set([
    ...report.created.map(entity),
    ...createdPageIds.map((id) => `page ${id}`),
  ]);
  const deleted = new Set(report.deleted.map(entity));
  return {
    created: report.created.filter((item) => !deleted.has(entity(item))),
    updated: report.updated.filter(
      (item) => !created.has(entity(item)) && !deleted.has(entity(item)),
    ),
    deleted: [...new Set(report.deleted)].map((item) =>
      created.has(entity(item)) ? `${item} (created in this run)` : item,
    ),
    raw: [...report.raw],
  };
}

/** Lint report for every page written, the artifacts, and what was created/updated/deleted, appended after the script's output. */
export function reportLines(
  pages: readonly PageReport[],
  artifacts: readonly ArtifactReport[],
  changes: ChangeReport,
  /** Free-text lines extensions added through `ctx.report.note`. */
  notes: readonly string[] = [],
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
    // One folder: print it once so Read/Edit can open any artifact as <folder>/<name>.
    const folder = dirname(artifacts[0].path);
    lines.push(
      `Artifacts: ${artifacts.map((file) => `${file.handle} (${formatBytes(file.bytes)})`).join(", ")} in ${folder}`,
    );
  }
  for (const [label, items] of [
    ["Created", changes.created],
    ["Updated", changes.updated],
    ["Deleted", changes.deleted],
    ["Raw", changes.raw],
  ] as const) {
    if (items.length === 0) continue;
    const shown = items.slice(0, MAX_CREATED_LISTED).join(", ");
    const more = items.length - MAX_CREATED_LISTED;
    lines.push(`${label}: ${shown}${more > 0 ? `, +${more} more` : ""}`);
  }
  lines.push(...notes);
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

function cleanMessage(error: unknown, paths?: DisplayPaths): string {
  return errnoMessage(error, paths) ?? messageOf(error);
}

/** A 403 names the resource ("no access to project APP"); other messages pass through. */
function failureMessage(
  error: unknown,
  resource?: string,
  paths?: DisplayPaths,
): string {
  return hostErrorCode(error) === "FORBIDDEN" && resource
    ? `no access to ${resource}`
    : cleanMessage(error, paths);
}

/** Script-side errors carry their code as a "[CODE] " prefix that the prelude turns into `error.code`. */
function hostFailure(
  error: unknown,
  resource?: string,
  paths?: DisplayPaths,
): Error {
  return new Error(
    `[${hostErrorCode(error)}] ${failureMessage(error, resource, paths)}`,
  );
}

/** For a 401, the message that ends the whole script; otherwise undefined. */
async function unauthorizedMessage(
  error: unknown,
  env: SdkEnvironment,
): Promise<string | undefined> {
  if (!(error instanceof ToolExecutionError)) return undefined;
  // The host's own 401 on an authenticated `ctx.http` request: the message names the account and the fix.
  if (error.code === "UNAUTHORIZED") return error.message;
  const product = /^(JIRA|CONFLUENCE)_UNAUTHORIZED$/.exec(error.code)?.[1];
  if (!product) return undefined;
  const connection = await (
    product === "JIRA" ? env.jira() : env.confluence()
  ).catch(() => undefined);
  const name = product === "JIRA" ? "Jira" : "Confluence";
  return `${name} rejected the API token${connection ? ` for ${connection.email}` : ""}; update it in Settings → Extensions → Atlassian.`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
