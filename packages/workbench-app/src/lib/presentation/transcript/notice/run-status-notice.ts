import type { RunStatusNotice } from "../../state/transcript-types";
import type { NoticeChip, TranscriptNoticeModel } from "./notice-presentation";

export type RunStatusNoticeOptions = {
  /** Clock reading used for the retry countdown; injected so this stays pure. */
  nowMs: number;
  onContinue?: () => void;
};

function retrySeconds(
  notice: RunStatusNotice,
  nowMs: number,
): number | undefined {
  const retryAtMs = notice.retryAt ? Date.parse(notice.retryAt) : Number.NaN;
  if (Number.isFinite(retryAtMs)) {
    return Math.max(0, Math.ceil((retryAtMs - nowMs) / 1000));
  }
  if (typeof notice.delayMs === "number" && notice.delayMs > 0) {
    return Math.ceil(notice.delayMs / 1000);
  }
  return undefined;
}

function attemptChip(notice: RunStatusNotice): NoticeChip | undefined {
  if (typeof notice.attempt !== "number") return undefined;
  return {
    text:
      typeof notice.maxRetries === "number"
        ? `retry ${notice.attempt}/${notice.maxRetries}`
        : `retry ${notice.attempt}`,
  };
}

export function runStatusNoticeModel(
  notice: RunStatusNotice,
  options: RunStatusNoticeOptions,
): TranscriptNoticeModel {
  const failure = notice.errorMessage?.trim() || undefined;
  const action = options.onContinue
    ? {
        label: "Continue",
        ariaLabel: "Continue this run",
        onClick: options.onContinue,
      }
    : undefined;

  if (notice.state === "retrying") {
    const seconds = retrySeconds(notice, options.nowMs);
    const chips: NoticeChip[] = [
      {
        text:
          seconds === undefined
            ? "retrying soon"
            : seconds > 0
              ? `retry in ${seconds}s`
              : "retrying now",
        tone: "info",
      },
    ];
    const attempt = attemptChip(notice);
    if (attempt) chips.push(attempt);
    return {
      kind: "run",
      tone: "info",
      glyph: "retry",
      busy: true,
      badge: "run_retrying",
      arg: failure ?? "request failed",
      statusLabel: "Retrying the model request",
      chips,
    };
  }

  if (notice.state === "interrupted") {
    return {
      kind: "run",
      tone: "warning",
      glyph: "bell-dot",
      badge: "run_interrupted",
      arg: failure ?? "host restarted",
      statusLabel: "Run interrupted",
      summary: "Nothing will resume until you choose Continue.",
      chips: [],
      action,
    };
  }

  const chips: NoticeChip[] = [];
  const attempt = attemptChip(notice);
  if (attempt) chips.push(attempt);
  return {
    kind: "run",
    tone: "destructive",
    glyph: "bell-dot",
    badge: "run_failed",
    arg: failure ?? "request failed",
    statusLabel: "Model request failed",
    chips,
    action,
  };
}
