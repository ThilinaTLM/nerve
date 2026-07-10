import type { AutoCompactionPolicy, CompactionSettings } from "./types.js";

/** Default compaction settings used by the harness. */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

const AUTO_COMPACTION_THRESHOLD_PERCENT = 90;
const AUTO_COMPACTION_KEEP_RECENT_PERCENT = 10;
const AUTO_COMPACTION_MIN_KEEP_RECENT_TOKENS = 4_000;
const AUTO_COMPACTION_MAX_KEEP_RECENT_TOKENS = 50_000;
const AUTO_COMPACTION_SUMMARY_RESERVE_TOKENS = 16_384;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function deriveAutoCompactionPolicy(
  contextWindow: number,
  enabled = true,
): AutoCompactionPolicy {
  const normalizedWindow = Number.isFinite(contextWindow)
    ? Math.max(0, Math.floor(contextWindow))
    : 0;
  if (normalizedWindow <= 0) {
    return {
      enabled,
      contextWindow: 0,
      thresholdPercent: AUTO_COMPACTION_THRESHOLD_PERCENT,
      thresholdTokens: 0,
      triggerReserveTokens: 0,
      keepRecentTokens: 0,
      summaryReserveTokens: AUTO_COMPACTION_SUMMARY_RESERVE_TOKENS,
    };
  }

  const thresholdTokens = Math.floor(
    normalizedWindow * (AUTO_COMPACTION_THRESHOLD_PERCENT / 100),
  );
  const maxKeepRecentTokens = Math.min(
    AUTO_COMPACTION_MAX_KEEP_RECENT_TOKENS,
    Math.floor(normalizedWindow * 0.5),
  );
  const keepRecentTokens = clamp(
    Math.floor(normalizedWindow * (AUTO_COMPACTION_KEEP_RECENT_PERCENT / 100)),
    Math.min(AUTO_COMPACTION_MIN_KEEP_RECENT_TOKENS, maxKeepRecentTokens),
    maxKeepRecentTokens,
  );

  return {
    enabled,
    contextWindow: normalizedWindow,
    thresholdPercent: AUTO_COMPACTION_THRESHOLD_PERCENT,
    thresholdTokens,
    triggerReserveTokens: Math.max(0, normalizedWindow - thresholdTokens),
    keepRecentTokens,
    summaryReserveTokens: AUTO_COMPACTION_SUMMARY_RESERVE_TOKENS,
  };
}

export function shouldAutoCompact(
  contextTokens: number | null | undefined,
  policy: AutoCompactionPolicy,
): boolean {
  if (
    !policy.enabled ||
    policy.contextWindow <= 0 ||
    policy.thresholdTokens <= 0
  ) {
    return false;
  }
  return (
    typeof contextTokens === "number" && contextTokens >= policy.thresholdTokens
  );
}

/** Return whether context usage exceeds the configured compaction threshold. */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  settings: CompactionSettings,
): boolean {
  if (!settings.enabled || contextWindow <= 0) return false;
  return contextTokens > contextWindow - settings.reserveTokens;
}
