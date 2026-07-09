import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ManagedSandboxRecord,
  type RedactedError,
  type SandboxOutboxRecord,
  type SandboxSetupStatusSummary,
  type SandboxSetupTimelineItem,
  type StartupSetupStatus,
  sandboxOutboxRecordSchema,
  summarizeSandboxStartupEvents,
} from "@nervekit/shared";

const MAX_TIMELINE_TEXT = 8_000;

export type AgentStateSummary = {
  setup?: SandboxSetupStatusSummary;
  setupTimeline?: SandboxSetupTimelineItem[];
  startupFailure?: { stage: string; error: RedactedError };
  lastEventSeq?: number;
  lastEventAt?: string;
};

export async function readAgentStateSummary(
  record: ManagedSandboxRecord,
): Promise<AgentStateSummary | undefined> {
  const stateDir = record.stateRef?.source;
  if (!stateDir) return undefined;
  const events = await readOutbox(
    path.join(stateDir, "events", "outbox.jsonl"),
  );
  if (events.length === 0) return undefined;
  return summarizeOutbox(events);
}

export function setupSummaryFailure(
  setup: SandboxSetupStatusSummary | undefined,
): RedactedError | undefined {
  for (const [phase, status] of Object.entries(setup ?? {})) {
    if (status?.status !== "failed") continue;
    return (
      status.error ?? {
        code: "SANDBOX_STARTUP_FAILED",
        message: `${phase} setup failed before the controller connected`,
      }
    );
  }
  return undefined;
}

async function readOutbox(file: string): Promise<SandboxOutboxRecord[]> {
  try {
    const text = await readFile(file, "utf8");
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          const parsed = sandboxOutboxRecordSchema.safeParse(JSON.parse(line));
          return parsed.success ? [parsed.data] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function summarizeOutbox(events: SandboxOutboxRecord[]): AgentStateSummary {
  const startup = summarizeSandboxStartupEvents(events);
  const lastEvent = [...events]
    .filter((event) => typeof event.seq === "number" || event.ts)
    .sort((a, b) => Number(a.seq ?? -1) - Number(b.seq ?? -1))
    .at(-1);
  return {
    setup: startup.setup,
    setupTimeline: startup.timeline.length > 0 ? startup.timeline : undefined,
    startupFailure: startup.failure
      ? { stage: startup.failure.stage, error: startup.failure.error }
      : undefined,
    lastEventSeq: lastEvent?.seq,
    lastEventAt: lastEvent?.ts,
  };
}

function applySetupEvent(
  setup: SandboxSetupStatusSummary,
  event: SandboxOutboxRecord,
): void {
  switch (event.type) {
    case "sandbox.setup.git.started":
      setup.git = started(event);
      return;
    case "sandbox.setup.git.completed":
      setup.git = completed(event, setup.git);
      return;
    case "sandbox.setup.github.started":
      setup.github = started(event);
      return;
    case "sandbox.setup.github.completed":
      setup.github = completed(event, setup.github);
      return;
    case "sandbox.skills.started":
      setup.skills = started(event);
      return;
    case "sandbox.skills.completed":
    case "sandbox.skills.loaded":
      setup.skills = completed(event, setup.skills);
      return;
    case "sandbox.boot.started":
      setup.boot = started(event);
      return;
    case "sandbox.boot.completed":
      setup.boot = completed(event, setup.boot, bootError(event));
      return;
    case "sandbox.boot_plan.completed":
      setup.boot = completed(event, setup.boot, errorFromData(event.data));
      return;
    default:
      return;
  }
}

function applySetupTimelineEvent(
  timeline: SandboxSetupTimelineItem[],
  event: SandboxOutboxRecord,
): void {
  const data = asRecord(event.data);
  switch (event.type) {
    case "sandbox.config.loaded":
      pushSetupTimeline(
        timeline,
        event,
        "config",
        data.status === "degraded" ? "degraded" : "completed",
        "Config loaded",
        detailsFromData(data),
      );
      return;
    case "sandbox.setup.git.started":
      pushSetupTimeline(
        timeline,
        event,
        "git",
        "started",
        undefined,
        detailsFromData(data),
      );
      return;
    case "sandbox.setup.git.completed":
      pushSetupTimeline(
        timeline,
        event,
        "git",
        setupTimelineStatus(data),
        undefined,
        detailsFromData(data),
      );
      return;
    case "sandbox.setup.github.started":
      pushSetupTimeline(
        timeline,
        event,
        "github",
        "started",
        undefined,
        detailsFromData(data),
      );
      return;
    case "sandbox.setup.github.completed":
      pushSetupTimeline(
        timeline,
        event,
        "github",
        setupTimelineStatus(data),
        undefined,
        detailsFromData(data),
      );
      return;
    case "sandbox.skills.started":
      pushSetupTimeline(
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
      pushSetupTimeline(
        timeline,
        event,
        "skills",
        setupTimelineStatus(data),
        "Skills loaded",
        detailsFromData(data),
      );
      return;
    case "sandbox.boot.started":
      pushSetupTimeline(
        timeline,
        event,
        "boot",
        "started",
        bootPhaseDetail(data),
        bootDetailsFromData(data),
      );
      return;
    case "sandbox.boot.completed":
      pushSetupTimeline(
        timeline,
        event,
        "boot",
        setupTimelineStatus(data),
        bootCompletedDetail(data),
        bootDetailsFromData(data),
      );
      return;
    case "sandbox.ready":
      pushSetupTimeline(
        timeline,
        event,
        "ready",
        "completed",
        "Sandbox ready",
        detailsFromData(data),
      );
      return;
    default:
      return;
  }
}

function pushSetupTimeline(
  timeline: SandboxSetupTimelineItem[],
  event: SandboxOutboxRecord,
  phase: string,
  status: SandboxSetupTimelineItem["status"],
  detailText?: string,
  extra: Partial<SandboxSetupTimelineItem> = {},
): void {
  const key = extra.key ?? setupTimelineKey(phase, event, extra);
  const existing = timeline.find((item) => item.key === key);
  const definedExtra = definedTimelineFields(extra);
  const next: SandboxSetupTimelineItem = {
    ...existing,
    ...definedExtra,
    key,
    phase,
    status,
    ts: event.ts,
    detail: detailText ?? extra.detail ?? existing?.detail,
  };
  if (next.startedAt && next.completedAt) {
    const durationMs =
      Date.parse(next.completedAt) - Date.parse(next.startedAt);
    if (Number.isFinite(durationMs) && durationMs >= 0)
      next.durationMs = durationMs;
  }
  if (existing) Object.assign(existing, next);
  else timeline.push(next);
}

function definedTimelineFields(
  extra: Partial<SandboxSetupTimelineItem>,
): Partial<SandboxSetupTimelineItem> {
  return Object.fromEntries(
    Object.entries(extra).filter(([, value]) => value !== undefined),
  ) as Partial<SandboxSetupTimelineItem>;
}

function setupTimelineKey(
  phase: string,
  event: SandboxOutboxRecord,
  extra: Partial<SandboxSetupTimelineItem>,
): string {
  if (phase === "boot") {
    const phaseKey =
      extra.index !== undefined ? String(extra.index) : extra.name;
    return `boot:${phaseKey ?? event.seq}`;
  }
  return phase;
}

function setupTimelineStatus(
  data: Record<string, unknown>,
): SandboxSetupTimelineItem["status"] {
  if (
    data.status === "failed" ||
    data.status === "timeout" ||
    data.status === "skipped" ||
    data.status === "degraded"
  )
    return data.status;
  if (data.status === "started") return "started";
  return "completed";
}

function bootPhaseDetail(data: Record<string, unknown>): string | undefined {
  const phase = stringValue(data.phase)?.trim() ?? "";
  return phase ? `Boot phase: ${phase}` : undefined;
}

function bootCompletedDetail(
  data: Record<string, unknown>,
): string | undefined {
  const detail = bootPhaseDetail(data);
  if (data.status !== "failed" && data.status !== "timeout") return detail;
  const exitCode =
    typeof data.exitCode === "number" ? `exit ${data.exitCode}` : undefined;
  return [detail, exitCode].filter(Boolean).join(" · ") || undefined;
}

function detailsFromData(
  data: Record<string, unknown>,
): Partial<SandboxSetupTimelineItem> {
  return {
    startedAt: stringValue(data.startedAt),
    completedAt: stringValue(data.completedAt),
    error: errorText(data.error),
    limitations: stringArray(data.limitations),
  };
}

function bootDetailsFromData(
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
    exitCode: numberValue(data.exitCode),
    stdout: boundedTimelineText(data.stdout),
    stderr: boundedTimelineText(data.stderr),
  };
}

function errorText(value: unknown): string | undefined {
  const record = asRecord(value);
  const message = stringValue(record.message);
  if (!message) return undefined;
  const code = stringValue(record.code);
  return code ? `${code}: ${message}` : message;
}

function boundedTimelineText(
  value: unknown,
): SandboxSetupTimelineItem["stdout"] | undefined {
  const record = asRecord(value);
  const text = stringValue(record.text);
  if (!text) return undefined;
  if (text.length <= MAX_TIMELINE_TEXT) {
    return {
      text,
      truncated: Boolean(record.truncated),
      bytes: numberValue(record.bytes),
    };
  }
  return {
    text: text.slice(0, MAX_TIMELINE_TEXT),
    truncated: true,
    bytes: numberValue(record.bytes),
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
  return strings.length > 0 ? strings : undefined;
}

function started(event: SandboxOutboxRecord): StartupSetupStatus {
  const data = asRecord(event.data);
  return {
    configured: true,
    status: "started",
    startedAt: stringValue(data.startedAt) ?? event.ts,
  };
}

function completed(
  event: SandboxOutboxRecord,
  previous: StartupSetupStatus | undefined,
  fallbackError?: RedactedError,
): StartupSetupStatus {
  const data = asRecord(event.data);
  const status = setupStatus(data.status) ?? "completed";
  const error =
    previous?.status === "failed" && previous.error
      ? previous.error
      : (errorFromData(data) ?? fallbackError);
  return {
    configured: true,
    status,
    startedAt: stringValue(data.startedAt) ?? previous?.startedAt,
    completedAt: stringValue(data.completedAt) ?? event.ts,
    error: status === "failed" ? error : undefined,
  };
}

function bootError(event: SandboxOutboxRecord): RedactedError | undefined {
  const data = asRecord(event.data);
  if (data.status !== "failed" && data.status !== "timeout") return undefined;
  const phase = stringValue(data.phase) ?? "boot";
  const exitCode =
    typeof data.exitCode === "number" ? data.exitCode : undefined;
  const stderr = boundedText(data.stderr);
  const suffix = stderr ? `: ${truncate(stderr)}` : "";
  return {
    code:
      data.status === "timeout" ? "BOOT_PHASE_TIMEOUT" : "BOOT_PHASE_FAILED",
    message: `Boot phase ${phase} ${data.status === "timeout" ? "timed out" : "failed"}${
      exitCode !== undefined ? ` with exit code ${exitCode}` : ""
    }${suffix}`,
  };
}

function errorFromData(value: unknown): RedactedError | undefined {
  const error = asRecord(value).error;
  const record = asRecord(error);
  const message = stringValue(record.message);
  if (!message) return undefined;
  return { code: stringValue(record.code) ?? "ERROR", message };
}

function boundedText(value: unknown): string | undefined {
  const record = asRecord(value);
  const text = stringValue(record.text);
  return text?.trim() || undefined;
}

function setupStatus(value: unknown): StartupSetupStatus["status"] | undefined {
  if (value === "timeout") return "failed";
  return value === "skipped" ||
    value === "started" ||
    value === "completed" ||
    value === "failed" ||
    value === "degraded"
    ? value
    : undefined;
}

function truncate(value: string): string {
  return value.length > 300 ? `${value.slice(0, 300)}…` : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
