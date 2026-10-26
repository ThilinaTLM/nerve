import {
  MIGRATION_ROLLED_BACK,
  type ServerLifecycle,
  type ServerLifecycleFailure,
} from "@nervekit/contracts/status";

export const LIFECYCLE_POLL_INTERVAL_MS = 500;
/** Disconnections shorter than this never show the reconnect overlay. */
export const RECONNECT_OVERLAY_DELAY_MS = 1000;

export const DEFAULT_STARTING_MESSAGE = "Starting Nerve";

export interface LifecycleView {
  status: string;
  /** Secondary line, e.g. `Importing conversations · 3 of 10`. */
  detail?: string;
  /** Determinate progress, when the total is known. */
  meter?: { done: number; total: number; fraction: number };
}

/** Maps a polled lifecycle (or `undefined` when unreachable) to display text. */
export function describeLifecycle(
  lifecycle: ServerLifecycle | undefined,
): LifecycleView {
  if (!lifecycle) return { status: DEFAULT_STARTING_MESSAGE };
  const status = lifecycle.message.trim() || DEFAULT_STARTING_MESSAGE;
  const progress = lifecycle.progress;
  if (!progress) return { status };
  const { done, total } = progress;
  const known = done !== undefined && total !== undefined && total > 0;
  const detail = `${progress.label}${known ? ` · ${done.toLocaleString()} of ${total.toLocaleString()}` : ""}`;
  return {
    status,
    detail,
    meter: known
      ? { done, total, fraction: Math.max(0, Math.min(1, done / total)) }
      : undefined,
  };
}

export function parseLifecycle(value: unknown): ServerLifecycle | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ServerLifecycle>;
  if (
    typeof candidate.state !== "string" ||
    !["starting", "upgrading", "ready", "failed"].includes(candidate.state) ||
    typeof candidate.version !== "string"
  ) {
    return undefined;
  }
  return candidate as ServerLifecycle;
}

export type ReadyAction = "reload" | "resume";

/**
 * Once the server is ready again after the app loaded: a new build needs a
 * fresh bundle; the same build (even a restart) recovers through the protocol.
 */
export function readyAction(
  bootVersion: string | undefined,
  lifecycle: ServerLifecycle,
): ReadyAction {
  return bootVersion !== undefined && bootVersion !== lifecycle.version
    ? "reload"
    : "resume";
}

export type FailureKind = "rolled-back" | "discardable" | "generic";

/** Which recovery screen a startup failure calls for. */
export function failureKind(
  failure: ServerLifecycleFailure | undefined,
): FailureKind {
  if (failure?.code === MIGRATION_ROLLED_BACK) return "rolled-back";
  return failure?.discardable?.length ? "discardable" : "generic";
}

type Discardable = NonNullable<ServerLifecycleFailure["discardable"]>[number];

export interface DiscardPlan {
  conversations: Discardable[];
  files: Discardable[];
  heading: string;
  /** Primary action label. */
  action: string;
  /** Confirmation dialog body. */
  confirmation: string;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** Copy and grouping for failures that can continue after discarding items. */
export function discardPlan(items: readonly Discardable[]): DiscardPlan {
  const conversations = items.filter((item) => item.kind === "conversation");
  const files = items.filter((item) => item.kind === "configuration");
  const fileCount = plural(files.length, "file", "files");
  const conversationCount = plural(
    conversations.length,
    "conversation",
    "conversations",
  );
  const confirmation =
    "These items will be set aside in quarantine. Their original data is kept until you delete it.";
  return {
    conversations,
    files,
    heading:
      conversations.length && files.length
        ? "Some data couldn't be read or upgraded"
        : files.length
          ? "Some settings files couldn't be upgraded"
          : "Some conversations couldn't be upgraded",
    action:
      conversations.length && files.length
        ? "Set aside and continue"
        : `Set aside ${files.length ? fileCount : conversationCount} and continue`,
    confirmation,
  };
}

export function diagnosticsText(
  failure: ServerLifecycleFailure,
  lifecycle?: ServerLifecycle,
): string {
  return [
    failure.message,
    `Code: ${failure.code}`,
    failure.phase ? `Phase: ${failure.phase}` : undefined,
    failure.step ? `Step: ${failure.step}` : undefined,
    failure.reportPath ? `Report: ${failure.reportPath}` : undefined,
    lifecycle ? `Version: ${lifecycle.version}` : undefined,
    lifecycle ? `Started: ${lifecycle.startedAt}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Fetches lifecycle; `undefined` on network errors or non-lifecycle bodies. */
export async function fetchLifecycle(): Promise<ServerLifecycle | undefined> {
  try {
    const response = await fetch("/api/lifecycle", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!(response.headers.get("content-type") ?? "").includes("json")) {
      return undefined;
    }
    return parseLifecycle(await response.json());
  } catch {
    return undefined;
  }
}

async function postLifecycleAction(
  path: string,
  body?: unknown,
): Promise<ServerLifecycle | undefined> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (response.status !== 202) return undefined;
    return parseLifecycle(await response.json());
  } catch {
    return undefined;
  }
}

/**
 * Asks the server to retry a failed start; `undefined` if not accepted.
 * `discardIds` sets aside those failed units in quarantine.
 */
export function postLifecycleRetry(
  discardIds?: string[],
): Promise<ServerLifecycle | undefined> {
  return postLifecycleAction(
    "/api/lifecycle/retry",
    discardIds?.length ? { discardIds } : undefined,
  );
}

/** Asks the server to restore the pre-upgrade data; `undefined` if refused. */
export function postLifecycleRollback(): Promise<ServerLifecycle | undefined> {
  return postLifecycleAction("/api/lifecycle/rollback");
}
