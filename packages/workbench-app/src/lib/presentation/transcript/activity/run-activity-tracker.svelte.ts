import type { ConversationActiveRunSnapshot } from "@nervekit/contracts/conversations";
import type { ConversationRunOutcome } from "../../state/conversation-render-state";
import type { TimelineItem } from "../../state/timeline";
import {
  deriveRunActivity,
  runActivitySignature,
  stabilizeRunActivity,
  type RunActivityView,
  type StableRunActivity,
} from "./run-activity";

export type RunActivitySource = {
  sending: boolean;
  activeRun?: ConversationActiveRunSnapshot;
  lastRunOutcome?: ConversationRunOutcome;
  stopping: boolean;
  compactionRunning: boolean;
  tail?: TimelineItem;
};

const TICK_MS = 250;

/**
 * Owns the client-side clock and observation stamps for the run activity
 * slot. Create it in the transcript list (not the virtualized row) so row
 * recycling never resets timers. Timestamps used for show/idle/linger timing
 * are client-observed; only elapsed and retry countdowns read server times.
 */
export function createRunActivityTracker(source: () => RunActivitySource): {
  readonly view: RunActivityView;
} {
  let now = $state(Date.now());
  let runSeenAtMs: number | undefined;
  let signature: string | undefined;
  let lastChangeAtMs = Date.now();
  // Outcomes present at creation belong to runs that ended before this view
  // existed; never replay their completion cue.
  let seenOutcomeRunId = source().lastRunOutcome?.runId;
  let outcomeSeenAtMs: number | undefined;
  let stable: StableRunActivity | undefined;

  const view = $derived.by(() => {
    const input = source();
    const nowMs = Math.max(now, Date.now());
    const active =
      input.sending ||
      Boolean(input.activeRun && input.activeRun.status !== "interrupted");
    if (active) runSeenAtMs ??= nowMs;
    else runSeenAtMs = undefined;

    const nextSignature = runActivitySignature(input.activeRun, input.tail);
    if (nextSignature !== signature) {
      signature = nextSignature;
      lastChangeAtMs = nowMs;
    }

    const outcomeRunId = input.lastRunOutcome?.runId;
    if (outcomeRunId !== seenOutcomeRunId) {
      seenOutcomeRunId = outcomeRunId;
      outcomeSeenAtMs = outcomeRunId ? nowMs : undefined;
    }

    stable = stabilizeRunActivity(
      stable,
      deriveRunActivity({
        ...input,
        nowMs,
        runSeenAtMs: runSeenAtMs ?? nowMs,
        lastChangeAtMs,
        outcomeSeenAtMs,
      }),
      nowMs,
    );
    return stable.view;
  });

  const mounted = $derived(view.mounted);
  $effect(() => {
    if (!mounted) return;
    now = Date.now();
    const interval = setInterval(() => {
      now = Date.now();
    }, TICK_MS);
    return () => clearInterval(interval);
  });

  return {
    get view() {
      return view;
    },
  };
}
