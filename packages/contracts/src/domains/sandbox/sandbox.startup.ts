import type {
  SandboxSetupStatusSummary,
  SandboxSetupTimelineItem,
} from "./sandbox.commands.schema.js";
import type {
  RedactedError,
  SandboxStartupStage,
  StartupSetupStatus,
} from "./sandbox.common.schema.js";

const MAX_TIMELINE_TEXT = 8_000;

export type SandboxStartupEventLike = {
  type: string;
  ts: string;
  seq?: number;
  data?: unknown;
};

export type SandboxStartupSummary = {
  setup?: SandboxSetupStatusSummary;
  timeline: SandboxSetupTimelineItem[];
  active?: SandboxSetupTimelineItem;
  failure?: {
    stage: string;
    error: RedactedError;
    item: SandboxSetupTimelineItem;
  };
};

export function summarizeSandboxStartupEvents(
  events: readonly SandboxStartupEventLike[],
): SandboxStartupSummary {
  const setup: SandboxSetupStatusSummary = {};
  const timeline: SandboxSetupTimelineItem[] = [];
  for (const event of events) {
    applySetupSummary(setup, event);
    applySandboxStartupEvent(timeline, event);
  }
  const ordered = timeline
    .map((item, order) => ({ item, order }))
    .sort((a, b) => {
      const byTime = itemTime(a.item) - itemTime(b.item);
      return byTime === 0 ? a.order - b.order : byTime;
    })
    .map(({ item }) => item);
  const active = [...ordered]
    .reverse()
    .find((item) => item.status === "started");
  const failed = [...ordered]
    .reverse()
    .find((item) => item.status === "failed" || item.status === "timeout");
  const error = failed ? timelineError(failed) : undefined;
  return {
    setup: Object.keys(setup).length > 0 ? setup : undefined,
    timeline: ordered,
    active,
    failure:
      failed && error
        ? { stage: failed.phase, error, item: failed }
        : undefined,
  };
}

export function applySandboxStartupEvent(
  timeline: SandboxSetupTimelineItem[],
  event: SandboxStartupEventLike,
): void {
  const data = asRecord(event.data);
  switch (event.type) {
    case "sandbox.startup.stage.started": {
      const stage = startupStage(data.stage);
      if (!stage) return;
      upsert(timeline, event, stage, "started", undefined, {
        key: stageKey(stage, data.attempt),
        startedAt: stringValue(data.startedAt) ?? event.ts,
      });
      return;
    }
    case "sandbox.startup.stage.completed": {
      const stage = startupStage(data.stage);
      if (!stage) return;
      upsert(
        timeline,
        event,
        stage,
        terminalStatus(data.status),
        stringValue(data.detail),
        {
          key: stageKey(stage, data.attempt),
          startedAt: stringValue(data.startedAt),
          completedAt: stringValue(data.completedAt) ?? event.ts,
          durationMs: numberValue(data.durationMs),
          limitations: stringArray(data.limitations),
          error: errorText(data.error),
        },
      );
      return;
    }
    case "sandbox.config.loaded":
      upsert(
        timeline,
        event,
        "config",
        data.status === "degraded" ? "degraded" : "completed",
        "Configuration loaded",
        detailsFromData(data),
      );
      return;
    case "sandbox.setup.git.started":
    case "sandbox.setup.github.started": {
      const phase = event.type.includes("github") ? "github" : "git";
      upsert(
        timeline,
        event,
        phase,
        "started",
        undefined,
        detailsFromData(data),
      );
      return;
    }
    case "sandbox.setup.git.completed":
    case "sandbox.setup.github.completed": {
      const phase = event.type.includes("github") ? "github" : "git";
      upsert(
        timeline,
        event,
        phase,
        terminalStatus(data.status),
        undefined,
        detailsFromData(data),
      );
      return;
    }
    case "sandbox.skills.started":
      upsert(
        timeline,
        event,
        "skills",
        "started",
        undefined,
        detailsFromData(data),
      );
      return;
    case "sandbox.skills.completed":
    case "sandbox.skills.loaded":
      upsert(
        timeline,
        event,
        "skills",
        data.status === "failed"
          ? "failed"
          : data.status === "degraded"
            ? "degraded"
            : "completed",
        "Skills loaded",
        detailsFromData(data),
      );
      return;
    case "sandbox.boot.started":
      upsert(
        timeline,
        event,
        "boot",
        "started",
        bootDetail(data),
        bootDetails(data),
      );
      return;
    case "sandbox.boot.completed":
      upsert(
        timeline,
        event,
        "boot",
        terminalStatus(data.status),
        bootDetail(data),
        bootDetails(data),
      );
      return;
    case "sandbox.ready":
      upsert(timeline, event, "ready", "completed", "Sandbox ready", {
        completedAt: stringValue(data.readyAt) ?? event.ts,
      });
  }
}

function applySetupSummary(
  setup: SandboxSetupStatusSummary,
  event: SandboxStartupEventLike,
): void {
  const data = asRecord(event.data);
  const phase = setupPhase(event.type);
  if (!phase) return;
  const previous = setup[phase];
  if (event.type.endsWith(".started")) {
    setup[phase] = {
      configured: true,
      status: "started",
      startedAt: stringValue(data.startedAt) ?? event.ts,
    };
    return;
  }
  const status = setupStatus(data.status);
  const error =
    errorRecord(data.error) ??
    (phase === "boot" ? bootFailure(data) : undefined);
  setup[phase] = {
    configured: true,
    status,
    startedAt: stringValue(data.startedAt) ?? previous?.startedAt,
    completedAt: stringValue(data.completedAt) ?? event.ts,
    limitations: stringArray(data.limitations),
    error: status === "failed" ? error : undefined,
  };
}

function setupPhase(type: string): keyof SandboxSetupStatusSummary | undefined {
  if (
    type === "sandbox.setup.git.started" ||
    type === "sandbox.setup.git.completed"
  )
    return "git";
  if (
    type === "sandbox.setup.github.started" ||
    type === "sandbox.setup.github.completed"
  )
    return "github";
  if (
    type === "sandbox.skills.started" ||
    type === "sandbox.skills.completed" ||
    type === "sandbox.skills.loaded"
  )
    return "skills";
  if (type === "sandbox.boot.started" || type === "sandbox.boot.completed")
    return "boot";
  return undefined;
}

function setupStatus(value: unknown): StartupSetupStatus["status"] {
  if (value === "failed" || value === "timeout") return "failed";
  if (value === "degraded" || value === "skipped") return value;
  return "completed";
}

function upsert(
  timeline: SandboxSetupTimelineItem[],
  event: SandboxStartupEventLike,
  phase: string,
  status: SandboxSetupTimelineItem["status"],
  detail?: string,
  extra: Partial<SandboxSetupTimelineItem> = {},
): void {
  const key =
    extra.key ?? (phase === "boot" ? bootKey(dataOf(event), event) : phase);
  const existing = timeline.find((item) => item.key === key);
  const next: SandboxSetupTimelineItem = {
    ...existing,
    ...defined(extra),
    key,
    phase,
    status,
    ts: event.ts,
    detail: detail ?? extra.detail ?? existing?.detail,
  };
  if (next.startedAt && next.completedAt && next.durationMs === undefined) {
    const duration = Date.parse(next.completedAt) - Date.parse(next.startedAt);
    if (Number.isFinite(duration) && duration >= 0) next.durationMs = duration;
  }
  if (existing) Object.assign(existing, next);
  else timeline.push(next);
}

function stageKey(stage: SandboxStartupStage, attempt: unknown): string {
  const value = numberValue(attempt) ?? 1;
  return value === 1 ? stage : `${stage}:${value}`;
}

function bootKey(
  data: Record<string, unknown>,
  event: SandboxStartupEventLike,
): string {
  return `boot:${numberValue(data.index) ?? stringValue(data.phase) ?? event.seq ?? event.ts}`;
}

function detailsFromData(
  data: Record<string, unknown>,
): Partial<SandboxSetupTimelineItem> {
  return {
    startedAt: stringValue(data.startedAt),
    completedAt: stringValue(data.completedAt),
    limitations: stringArray(data.limitations),
    error: errorText(data.error),
  };
}

function bootDetails(
  data: Record<string, unknown>,
): Partial<SandboxSetupTimelineItem> {
  return {
    ...detailsFromData(data),
    name: stringValue(data.phase),
    index: numberValue(data.index),
    runAs:
      data.runAs === "root" || data.runAs === "sandbox"
        ? data.runAs
        : undefined,
    network:
      data.network === "inherit" ||
      data.network === "deny" ||
      data.network === "package_registries_only"
        ? data.network
        : undefined,
    timeoutMs: numberValue(data.timeoutMs),
    durationMs: numberValue(data.durationMs),
    exitCode: numberValue(data.exitCode),
    stdout: boundedText(data.stdout),
    stderr: boundedText(data.stderr),
  };
}

function bootDetail(data: Record<string, unknown>): string | undefined {
  const name = stringValue(data.phase);
  if (!name) return undefined;
  const exit = numberValue(data.exitCode);
  return `Boot command: ${name}${exit === undefined ? "" : ` · exit ${exit}`}`;
}

function terminalStatus(value: unknown): SandboxSetupTimelineItem["status"] {
  if (
    value === "failed" ||
    value === "timeout" ||
    value === "skipped" ||
    value === "degraded"
  )
    return value;
  return "completed";
}

function startupStage(value: unknown): SandboxStartupStage | undefined {
  return typeof value === "string" &&
    [
      "config",
      "state",
      "controller",
      "preflight",
      "models",
      "secrets",
      "git",
      "github",
      "context",
      "skills",
      "boot",
      "runtime",
      "ready",
    ].includes(value)
    ? (value as SandboxStartupStage)
    : undefined;
}

function timelineError(
  item: SandboxSetupTimelineItem,
): RedactedError | undefined {
  if (item.error) {
    const match = /^([A-Z][A-Z0-9_]+):\s*(.+)$/s.exec(item.error);
    return match
      ? { code: match[1], message: match[2] }
      : { code: "SANDBOX_STARTUP_FAILED", message: item.error };
  }
  if (item.phase === "boot") {
    const name = item.name ?? "boot command";
    const stderr = item.stderr?.text.trim();
    return {
      code:
        item.status === "timeout" ? "BOOT_PHASE_TIMEOUT" : "BOOT_PHASE_FAILED",
      message: `${name} ${item.status === "timeout" ? "timed out" : "failed"}${item.exitCode === undefined ? "" : ` with exit code ${item.exitCode}`}${stderr ? `: ${truncate(stderr, 300)}` : ""}`,
    };
  }
  return undefined;
}

function bootFailure(data: Record<string, unknown>): RedactedError | undefined {
  if (data.status !== "failed" && data.status !== "timeout") return undefined;
  const name = stringValue(data.phase) ?? "boot command";
  const exit = numberValue(data.exitCode);
  const stderr = boundedText(data.stderr)?.text.trim();
  return {
    code:
      data.status === "timeout" ? "BOOT_PHASE_TIMEOUT" : "BOOT_PHASE_FAILED",
    message: `${name} ${data.status === "timeout" ? "timed out" : "failed"}${exit === undefined ? "" : ` with exit code ${exit}`}${stderr ? `: ${truncate(stderr, 300)}` : ""}`,
  };
}

function errorRecord(value: unknown): RedactedError | undefined {
  const record = asRecord(value);
  const message = stringValue(record.message);
  if (!message) return undefined;
  return {
    code: stringValue(record.code) ?? "ERROR",
    message,
    retryable:
      typeof record.retryable === "boolean" ? record.retryable : undefined,
  };
}

function errorText(value: unknown): string | undefined {
  const error = errorRecord(value);
  return error ? `${error.code}: ${error.message}` : undefined;
}

function boundedText(
  value: unknown,
): SandboxSetupTimelineItem["stdout"] | undefined {
  const record = asRecord(value);
  const text = typeof record.text === "string" ? record.text : undefined;
  if (!text) return undefined;
  return {
    text:
      text.length > MAX_TIMELINE_TEXT ? text.slice(0, MAX_TIMELINE_TEXT) : text,
    truncated: text.length > MAX_TIMELINE_TEXT || Boolean(record.truncated),
    bytes: numberValue(record.bytes),
  };
}

function itemTime(item: SandboxSetupTimelineItem): number {
  const value = Date.parse(item.startedAt ?? item.completedAt ?? item.ts);
  return Number.isFinite(value) ? value : 0;
}

function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function dataOf(event: SandboxStartupEventLike): Record<string, unknown> {
  return asRecord(event.data);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0,
  );
  return values.length ? values : undefined;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
