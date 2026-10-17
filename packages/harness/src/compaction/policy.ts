import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import type {
  AutoCompactionPolicy,
  CompactionSettings,
} from "./compaction-policy.js";

/** Fixed recent-history target, subject to model headroom and safe cut points. */
export const DEFAULT_KEEP_RECENT_TOKENS = 10_000;

/** Default compaction settings used by the manual harness API. */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: DEFAULT_KEEP_RECENT_TOKENS,
};

export const DEFAULT_AUTO_COMPACTION_SETTINGS: AutoCompactionSettings = {
  auto: true,
  profile: "balanced",
  customTriggerPercent: 80,
};

export const AUTO_COMPACTION_PROFILES = {
  aggressive: { thresholdPercent: 70 },
  balanced: { thresholdPercent: 80 },
  conservative: { thresholdPercent: 90 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveAutoCompactionThreshold(
  settings: AutoCompactionSettings,
): number {
  return settings.profile === "custom"
    ? clamp(Math.floor(settings.customTriggerPercent), 60, 90)
    : AUTO_COMPACTION_PROFILES[settings.profile].thresholdPercent;
}

export function deriveAutoCompactionPolicy(
  contextWindow: number,
  settings: AutoCompactionSettings = DEFAULT_AUTO_COMPACTION_SETTINGS,
): AutoCompactionPolicy {
  const normalizedWindow = Number.isFinite(contextWindow)
    ? Math.max(0, Math.floor(contextWindow))
    : 0;
  const thresholdPercent = resolveAutoCompactionThreshold(settings);
  if (normalizedWindow <= 0) {
    return {
      enabled: settings.auto,
      profile: settings.profile,
      contextWindow: 0,
      thresholdPercent,
      thresholdTokens: 0,
      triggerReserveTokens: 0,
      keepRecentTokens: 0,
      summaryReserveTokens: 0,
      safetyHeadroomTokens: 0,
    };
  }

  const thresholdTokens = Math.floor(
    normalizedWindow * (thresholdPercent / 100),
  );
  const summaryReserveTokens = clamp(
    Math.floor(normalizedWindow * 0.08),
    Math.min(1_024, normalizedWindow),
    Math.min(16_384, normalizedWindow),
  );
  const safetyHeadroomTokens = Math.min(
    Math.max(1_024, Math.floor(normalizedWindow * 0.1)),
    normalizedWindow,
  );
  const maximumKeepRecentTokens = Math.max(
    0,
    thresholdTokens - summaryReserveTokens - safetyHeadroomTokens,
  );
  const keepRecentTokens = Math.min(
    DEFAULT_KEEP_RECENT_TOKENS,
    maximumKeepRecentTokens,
  );

  return {
    enabled: settings.auto,
    profile: settings.profile,
    contextWindow: normalizedWindow,
    thresholdPercent,
    thresholdTokens,
    triggerReserveTokens: Math.max(0, normalizedWindow - thresholdTokens),
    keepRecentTokens,
    summaryReserveTokens,
    safetyHeadroomTokens,
  };
}

/** Manual compaction is independent of the auto switch, but uses the same model-window policy. */
export function deriveManualCompactionSettings(
  contextWindow: number,
  settings: AutoCompactionSettings = DEFAULT_AUTO_COMPACTION_SETTINGS,
): CompactionSettings {
  const policy = deriveAutoCompactionPolicy(contextWindow, settings);
  return {
    enabled: true,
    reserveTokens: policy.summaryReserveTokens,
    keepRecentTokens: policy.keepRecentTokens,
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
