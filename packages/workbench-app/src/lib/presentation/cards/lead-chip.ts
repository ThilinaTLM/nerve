import type { MetaItem } from "./card-presentation";

/**
 * The lead chip is the card's one lifecycle chip. It exists from the first
 * frame and morphs in place, so the footer never pops in or out:
 *
 * drafting → checking → needs approval → queued → live clock → final duration
 *
 * with `denied`, `cancelled`, `dismissed` and `waiting for you` as the other
 * ends.
 */
export type LeadStage =
  | "drafting"
  | "supervising"
  | "approval"
  | "queued"
  | "waiting_for_user"
  | "running"
  | "completed"
  | "failed"
  | "denied"
  | "cancelled"
  | "dismissed"
  | "outcome_unknown";

export const LEAD_CHIP_KEY = "lead";

export type LeadChipInput = {
  stage: LeadStage;
  /** Execution start (ms epoch), when known. */
  startedAtMs?: number | undefined;
  /** Settle time (ms epoch), when known. */
  settledAtMs?: number | undefined;
  nowMs: number;
};

/** Live stopwatch: m:ss, h:mm:ss past an hour. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}`
    : `${minutes}:${ss}`;
}

/** Final duration: `840ms`, `4.2s`, `1m 05s`. */
export function formatFinalDuration(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  const total = Math.floor(value / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}m ${seconds}s`;
}

function duration(input: LeadChipInput): string | undefined {
  if (input.startedAtMs === undefined || input.settledAtMs === undefined)
    return undefined;
  if (!Number.isFinite(input.startedAtMs + input.settledAtMs)) return undefined;
  return formatFinalDuration(input.settledAtMs - input.startedAtMs);
}

export function leadChip(input: LeadChipInput): MetaItem {
  const key = LEAD_CHIP_KEY;
  switch (input.stage) {
    case "drafting":
      return { key, text: "drafting" };
    case "supervising":
      return { key, text: "checking" };
    case "approval":
      return { key, text: "needs approval", tone: "warning" };
    case "queued":
      return { key, text: "queued", tone: "info" };
    case "waiting_for_user":
      return { key, text: "waiting for you", tone: "warning" };
    case "running":
      return {
        key,
        text: formatClock(
          input.startedAtMs === undefined ? 0 : input.nowMs - input.startedAtMs,
        ),
        tone: "info",
      };
    case "completed":
      return { key, text: duration(input) ?? "completed" };
    case "failed": {
      const text = duration(input);
      return text
        ? { key, text }
        : { key, text: "failed", tone: "destructive" };
    }
    case "denied":
      return { key, text: "denied", tone: "destructive" };
    case "cancelled":
      return { key, text: "cancelled", tone: "warning" };
    case "dismissed":
      return { key, text: "dismissed", tone: "warning" };
    case "outcome_unknown":
      return { key, text: "outcome unknown", tone: "warning" };
  }
}

export const RISK_CHIP_KEY = "risk";

/** Supervisor risk chip: only when approval was required; it persists. */
export function riskChip(
  supervision:
    | { decision: string; effectiveRisk?: string | undefined }
    | null
    | undefined,
): MetaItem | undefined {
  if (supervision?.decision !== "approval" || !supervision.effectiveRisk)
    return undefined;
  const risk = supervision.effectiveRisk;
  return {
    key: RISK_CHIP_KEY,
    text: risk.replaceAll("_", " "),
    tone:
      risk === "destructive" || risk === "secret" ? "destructive" : "warning",
  };
}
