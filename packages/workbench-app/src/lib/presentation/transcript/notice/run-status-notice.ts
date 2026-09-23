import {
  normalizeRunFailure,
  type RunFailureCategory,
} from "@nervekit/contracts/runs";
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

const CATEGORY_LABELS: Record<RunFailureCategory, string> = {
  rate_limit: "Rate limit",
  authentication: "Authentication error",
  connection: "Connection error",
  provider: "API error",
  harness: "Harness error",
  unknown: "Run error",
};

function failurePresentation(notice: RunStatusNotice): {
  message?: string;
  category: RunFailureCategory;
  label: string;
  httpStatus?: number;
} {
  if (!notice.errorMessage?.trim()) {
    const category = notice.failureCategory ?? "unknown";
    return {
      category,
      label: CATEGORY_LABELS[category],
      httpStatus: notice.httpStatus,
    };
  }
  const normalized = normalizeRunFailure(notice.errorMessage);
  const category = notice.failureCategory ?? normalized.category;
  return {
    message: normalized.message,
    category,
    label: CATEGORY_LABELS[category],
    httpStatus: notice.httpStatus ?? normalized.httpStatus,
  };
}

function httpChip(httpStatus?: number): NoticeChip | undefined {
  return httpStatus ? { text: `HTTP ${httpStatus}`, mono: true } : undefined;
}

export function runStatusNoticeModel(
  notice: RunStatusNotice,
  options: RunStatusNoticeOptions,
): TranscriptNoticeModel {
  const failure = failurePresentation(notice);
  const primaryAction = options.onContinue
    ? {
        label: "Continue",
        ariaLabel: "Continue this run",
        onClick: options.onContinue,
      }
    : undefined;

  if (notice.state === "retrying") {
    const seconds = retrySeconds(notice, options.nowMs);
    const chips: NoticeChip[] = [
      { text: "UI-only", tone: "neutral" },
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
    const status = httpChip(failure.httpStatus);
    if (status) chips.push(status);
    return {
      kind: "run",
      tone: "info",
      glyph: "retry",
      busy: true,
      badge: "run_retrying",
      arg: failure.label,
      statusLabel: "Retrying the model request",
      summary: failure.message,
      chips,
    };
  }

  const chips: NoticeChip[] = [{ text: "UI-only", tone: "neutral" }];
  const attempt = attemptChip(notice);
  if (attempt) chips.push(attempt);
  const status = httpChip(failure.httpStatus);
  if (status) chips.push(status);

  if (notice.state === "interrupted") {
    return {
      kind: "run",
      tone: "destructive",
      glyph: "bell-dot",
      badge: "run_interrupted",
      arg: failure.label,
      statusLabel: "Run interrupted",
      error: failure.message,
      summary: primaryAction
        ? "Nothing will resume until you choose Continue."
        : undefined,
      chips,
      primaryAction,
    };
  }

  return {
    kind: "run",
    tone: "destructive",
    glyph: "bell-dot",
    badge: "run_failed",
    arg: failure.label,
    statusLabel: "Run failed",
    error: failure.message,
    chips,
    primaryAction,
  };
}
