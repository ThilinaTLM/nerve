import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type ManagedSandboxRecord,
  type RedactedError,
  type SandboxOutboxRecord,
  type SandboxSetupStatusSummary,
  type SandboxSetupTimelineItem,
  sandboxOutboxRecordSchema,
  summarizeSandboxStartupEvents,
} from "@nervekit/shared";

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
  const startup = summarizeSandboxStartupEvents(events);
  const lastEvent = [...events].sort((a, b) => a.seq - b.seq).at(-1);
  return {
    setup: startup.setup,
    setupTimeline: startup.timeline.length ? startup.timeline : undefined,
    startupFailure: startup.failure
      ? { stage: startup.failure.stage, error: startup.failure.error }
      : undefined,
    lastEventSeq: lastEvent?.seq,
    lastEventAt: lastEvent?.ts,
  };
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
