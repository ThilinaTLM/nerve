import type { ConversationActiveRunSnapshot } from "@nervekit/contracts/conversations";
import type { StatusTone } from "@nervekit/ui-kit/display/status";
import type { ConversationRunOutcome } from "../../state/conversation-render-state";
import type { TimelineItem } from "../../state/timeline";

/** Wait before any label appears, so fast replies never flash the slot. */
export const SHOW_DELAY_MS = 300;
/** Once an active label is shown, keep it at least this long. */
export const MIN_VISIBLE_MS = 400;
/** A streaming block that stops growing for this long reads as thinking. */
export const IDLE_STREAM_MS = 1500;
/** Waits longer than this soften to "Still thinking…". */
export const LONG_WAIT_MS = 20_000;
/** The elapsed timer only appears once the run is long enough to matter. */
export const TIMER_AFTER_MS = 3_000;
/** How long the completion cue stays before the slot collapses. */
export const DONE_LINGER_MS = 2_200;
/** Runs shorter than this finish silently instead of saying "Done". */
export const DONE_MIN_RUN_MS = 3_000;
/** Collapse transition budget before the row unmounts. */
export const CLOSE_MS = 300;

export type RunActivityKind = "active" | "quiet" | "retry" | "done" | "stopped";
export type RunActivityTone = Extract<
  StatusTone,
  "neutral" | "warning" | "success"
>;

/** Slow spinner turn while the run waits on the user. */
export const WAITING_SPINNER_RATE = 0.4;

export type RunActivityView = {
  /** Whether the transcript should render the slot row at all. */
  mounted: boolean;
  /** Expanded (visible) vs collapsed; collapsing rows stay mounted briefly. */
  open: boolean;
  kind: RunActivityKind;
  /** Stable identity for label transitions; text may change within a key. */
  labelKey?: string;
  label?: string;
  tone: RunActivityTone;
  /** Remaining retry delay as a 0..1 fraction. */
  countdownFraction?: number;
  elapsedLabel?: string;
  /** Spinner playback rate; 0 pauses it. */
  spinnerRate: number;
};

export type RunActivityInput = {
  sending: boolean;
  activeRun?: ConversationActiveRunSnapshot;
  lastRunOutcome?: ConversationRunOutcome;
  stopping: boolean;
  compactionRunning: boolean;
  /** Last rendered timeline item (prefix + tail). */
  tail?: TimelineItem;
  nowMs: number;
  /** Client time the current run was first observed as active. */
  runSeenAtMs: number;
  /** Client time the run/tail signature last changed. */
  lastChangeAtMs: number;
  /** Client time the current `lastRunOutcome` was observed ending a run. */
  outcomeSeenAtMs?: number;
};

export type TailPhase =
  | "prompt"
  | "streaming"
  | "settling"
  | "tool"
  | "awaiting_user"
  | "after_tools"
  | "thinking";

const HIDDEN: RunActivityView = {
  mounted: false,
  open: false,
  kind: "quiet",
  tone: "neutral",
  spinnerRate: 1,
};

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function tailPhase(tail: TimelineItem | undefined): TailPhase {
  if (!tail) return "thinking";
  if (tail.kind === "message") {
    if (tail.item.role === "user") return "prompt";
    if (tail.item.live && !tail.item.done) return "streaming";
    // Finished assistant output is usually the final answer; give the run
    // time to complete before calling it thinking again.
    if (tail.item.role === "assistant") return "settling";
    return "thinking";
  }
  if (tail.kind === "tool") {
    const status = tail.toolCall?.status;
    if (!status) return "tool";
    if (status === "waiting") return "awaiting_user";
    if (status === "committed" || status === "running") return "tool";
    return "after_tools";
  }
  return "thinking";
}

/**
 * Cheap identity of "something visibly changed". The caller stamps
 * `lastChangeAtMs` whenever this string changes; idle and long-wait timing
 * is measured from that stamp.
 */
export function runActivitySignature(
  activeRun: ConversationActiveRunSnapshot | undefined,
  tail: TimelineItem | undefined,
): string {
  const run = activeRun
    ? `${activeRun.runId}:${activeRun.status}:${activeRun.turns.length}:${activeRun.retry?.attempt ?? 0}`
    : "";
  if (!tail) return run;
  if (tail.kind === "message") {
    return `${run}|${tail.key}:${tail.item.text.length}:${tail.item.done ? 1 : 0}`;
  }
  if (tail.kind === "tool") {
    return `${run}|${tail.key}:${tail.toolCall?.status ?? ""}:${tail.draft?.block.done ? 1 : 0}`;
  }
  return `${run}|${tail.key}`;
}

function parseMs(value: string | undefined): number | undefined {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finishedView(input: RunActivityInput): RunActivityView {
  const outcome = input.lastRunOutcome;
  if (!outcome || input.outcomeSeenAtMs === undefined) return HIDDEN;
  const since = input.nowMs - input.outcomeSeenAtMs;
  const start = parseMs(outcome.startedAt);
  const end = parseMs(outcome.endedAt);
  const duration =
    start !== undefined && end !== undefined ? Math.max(0, end - start) : 0;
  const cue =
    outcome.outcome === "stopped" ||
    (outcome.outcome === "completed" && duration >= DONE_MIN_RUN_MS);
  if (!cue) {
    return since < CLOSE_MS ? { ...HIDDEN, mounted: true } : HIDDEN;
  }
  if (since >= DONE_LINGER_MS + CLOSE_MS) return HIDDEN;
  const stopped = outcome.outcome === "stopped";
  return {
    mounted: true,
    open: since < DONE_LINGER_MS,
    kind: stopped ? "stopped" : "done",
    labelKey: stopped ? "stopped" : "done",
    label: stopped
      ? `Stopped after ${formatElapsed(duration)}`
      : `Done in ${formatElapsed(duration)}`,
    tone: stopped ? "neutral" : "success",
    spinnerRate: 1,
  };
}

/** Pure projection of run state into the tail activity slot. */
export function deriveRunActivity(input: RunActivityInput): RunActivityView {
  const run = input.activeRun;
  const active = input.sending || Boolean(run && run.status !== "interrupted");
  if (!active) return finishedView(input);
  if (input.compactionRunning || run?.status === "interrupted") return HIDDEN;

  const now = input.nowMs;
  const runStart = parseMs(run?.startedAt) ?? input.runSeenAtMs;
  const runElapsed = Math.max(0, now - runStart);
  const base = {
    mounted: true,
    open: now - input.runSeenAtMs >= SHOW_DELAY_MS,
    elapsedLabel:
      runElapsed >= TIMER_AFTER_MS ? formatElapsed(runElapsed) : undefined,
    spinnerRate: 1,
  };
  const quiet = (label?: string): RunActivityView => ({
    ...base,
    kind: "quiet",
    tone: "neutral",
    spinnerRate: 0.8,
    ...(label ? { label, labelKey: label } : {}),
  });

  if (input.stopping || run?.status === "aborting") {
    return {
      ...base,
      kind: "active",
      labelKey: "stopping",
      label: "Stopping…",
      tone: "neutral",
    };
  }

  if (run?.status === "retrying" && run.retry) {
    const retry = run.retry;
    const retryAt = parseMs(retry.retryAt);
    const remaining = retryAt === undefined ? 0 : Math.max(0, retryAt - now);
    const seconds = Math.ceil(remaining / 1000);
    const attempt = `(${retry.attempt}/${retry.maxRetries})`;
    return {
      ...base,
      kind: "retry",
      labelKey: `retry:${retry.attempt}`,
      label:
        seconds > 0
          ? `Provider error · retrying in ${seconds}s ${attempt}`
          : `Retrying ${attempt}…`,
      tone: "warning",
      countdownFraction:
        retry.delayMs > 0 ? Math.min(1, remaining / retry.delayMs) : 0,
    };
  }

  const phase = tailPhase(input.tail);
  if (run?.status === "waiting" || phase === "awaiting_user") {
    // Human time is open-ended, so no ticking clock while the run is parked
    // on an approval, question, or plan review. The spinner keeps a slow,
    // calm turn so the run still reads as alive rather than frozen.
    return {
      ...quiet("Waiting for you"),
      elapsedLabel: undefined,
      spinnerRate: WAITING_SPINNER_RATE,
    };
  }
  if (phase === "tool") return quiet();

  const waited = Math.max(0, now - input.lastChangeAtMs);
  if (
    (phase === "streaming" || phase === "settling") &&
    waited < IDLE_STREAM_MS
  ) {
    return quiet();
  }
  if (waited < SHOW_DELAY_MS) return quiet();

  const longWait = waited >= LONG_WAIT_MS;
  const label = longWait
    ? "Still thinking…"
    : phase === "after_tools"
      ? "Reading results…"
      : !run || run.turns.length === 0
        ? "Starting…"
        : "Thinking…";
  return {
    ...base,
    kind: "active",
    labelKey: label,
    label,
    tone: "neutral",
    spinnerRate: longWait ? 0.5 : 1,
  };
}

export type StableRunActivity = {
  view: RunActivityView;
  activeSince: number;
};

/**
 * Hold an active label for `MIN_VISIBLE_MS` so fast tool loops or short
 * stream pauses never flicker it. Elapsed/open state always stays current.
 */
export function stabilizeRunActivity(
  previous: StableRunActivity | undefined,
  next: RunActivityView,
  nowMs: number,
): StableRunActivity {
  const prev = previous?.view;
  if (
    prev?.kind === "active" &&
    next.mounted &&
    next.kind === "quiet" &&
    !next.label &&
    nowMs - previous!.activeSince < MIN_VISIBLE_MS
  ) {
    return {
      view: {
        ...next,
        kind: prev.kind,
        label: prev.label,
        labelKey: prev.labelKey,
        tone: prev.tone,
        spinnerRate: prev.spinnerRate,
      },
      activeSince: previous!.activeSince,
    };
  }
  const becameActive = next.kind === "active" && prev?.kind !== "active";
  return {
    view: next,
    activeSince: becameActive ? nowMs : (previous?.activeSince ?? nowMs),
  };
}
