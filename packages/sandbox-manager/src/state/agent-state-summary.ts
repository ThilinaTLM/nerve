import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ManagedSandboxRecord,
  type RedactedError,
  type SandboxOutboxRecord,
  type SandboxSetupStatusSummary,
  type StartupSetupStatus,
  sandboxOutboxRecordSchema,
} from "@nervekit/shared";

export type AgentStateSummary = {
  setup?: SandboxSetupStatusSummary;
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
  const setup: SandboxSetupStatusSummary = {};
  for (const event of events) applySetupEvent(setup, event);
  const lastEvent = [...events]
    .filter((event) => typeof event.seq === "number" || event.ts)
    .sort((a, b) => Number(a.seq ?? -1) - Number(b.seq ?? -1))
    .at(-1);
  return {
    setup: Object.keys(setup).length > 0 ? setup : undefined,
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
  if (data.status !== "failed") return undefined;
  const phase = stringValue(data.phase) ?? "boot";
  const exitCode =
    typeof data.exitCode === "number" ? data.exitCode : undefined;
  const stderr = boundedText(data.stderr);
  const suffix = stderr ? `: ${truncate(stderr)}` : "";
  return {
    code: "BOOT_PHASE_FAILED",
    message: `Boot phase ${phase} failed${
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
