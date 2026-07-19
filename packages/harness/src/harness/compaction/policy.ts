import type { AutoCompactionSettings } from "@nervekit/contracts";
import type { AutoCompactionPolicy, CompactionSettings } from "./types.js";

/** Default compaction settings used by the manual harness API. */
export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

export const DEFAULT_AUTO_COMPACTION_SETTINGS: AutoCompactionSettings = {
  auto: true,
  profile: "balanced",
  customTriggerPercent: 80,
  customKeepRecentPercent: 15,
};

export const AUTO_COMPACTION_PROFILES = {
  aggressive: { thresholdPercent: 70, keepRecentPercent: 10 },
  balanced: { thresholdPercent: 80, keepRecentPercent: 15 },
  conservative: { thresholdPercent: 90, keepRecentPercent: 25 },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveAutoCompactionPercentages(
  settings: AutoCompactionSettings,
): { thresholdPercent: number; keepRecentPercent: number } {
  if (settings.profile === "custom") {
    return {
      thresholdPercent: clamp(
        Math.floor(settings.customTriggerPercent),
        60,
        90,
      ),
      keepRecentPercent: clamp(
        Math.floor(settings.customKeepRecentPercent),
        5,
        40,
      ),
    };
  }
  return AUTO_COMPACTION_PROFILES[settings.profile];
}

export function deriveAutoCompactionPolicy(
  contextWindow: number,
  settings: AutoCompactionSettings = DEFAULT_AUTO_COMPACTION_SETTINGS,
): AutoCompactionPolicy {
  const normalizedWindow = Number.isFinite(contextWindow)
    ? Math.max(0, Math.floor(contextWindow))
    : 0;
  const { thresholdPercent, keepRecentPercent } =
    resolveAutoCompactionPercentages(settings);
  if (normalizedWindow <= 0) {
    return {
      enabled: settings.auto,
      profile: settings.profile,
      contextWindow: 0,
      thresholdPercent,
      keepRecentPercent,
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
  const minimumKeepRecentTokens = Math.min(
    2_000,
    Math.floor(normalizedWindow * 0.25),
  );
  const maximumKeepRecentTokens = Math.max(
    0,
    thresholdTokens - summaryReserveTokens - safetyHeadroomTokens,
  );
  const desiredKeepRecentTokens = Math.floor(
    normalizedWindow * (keepRecentPercent / 100),
  );
  const keepRecentTokens = clamp(
    desiredKeepRecentTokens,
    Math.min(minimumKeepRecentTokens, maximumKeepRecentTokens),
    maximumKeepRecentTokens,
  );

  return {
    enabled: settings.auto,
    profile: settings.profile,
    contextWindow: normalizedWindow,
    thresholdPercent,
    keepRecentPercent,
    thresholdTokens,
    triggerReserveTokens: Math.max(0, normalizedWindow - thresholdTokens),
    keepRecentTokens,
    summaryReserveTokens,
    safetyHeadroomTokens,
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
