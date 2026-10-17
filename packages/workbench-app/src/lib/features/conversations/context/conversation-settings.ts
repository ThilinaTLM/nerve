import {
  autoCompactionSettingsSchema,
  type AutoCompactionSettings,
} from "@nervekit/contracts/settings";
import type { HarnessCompactionSource } from "@nervekit/contracts/core";
import { compactionProfileItems } from "$lib/presentation/settings/compaction-options";
import {
  SUBAGENT_INSTRUCTIONS_MAX_BYTES,
  utf8ByteLength,
} from "@nervekit/contracts/subagents";

const PROFILE_LABELS: Record<AutoCompactionSettings["profile"], string> = {
  aggressive: "Aggressive",
  balanced: "Balanced",
  conservative: "Conservative",
  custom: "Custom",
};

/** One-line description, e.g. `Balanced` or `Custom · 75%`. */
export function compactionSummary(settings: AutoCompactionSettings): string {
  if (!settings.auto) return "Off";
  const label = PROFILE_LABELS[settings.profile];
  return settings.profile === "custom"
    ? `${label} · ${settings.customTriggerPercent}%`
    : label;
}

/** What the effective setting does, e.g. `Compact at 80% and retain about 10,000 recent tokens`. */
export function compactionDetail(settings: AutoCompactionSettings): string {
  if (!settings.auto) return "Auto-compaction is off";
  if (settings.profile === "custom")
    return `Compact at ${settings.customTriggerPercent}% and retain about 10,000 recent tokens`;
  return (
    compactionProfileItems.find((item) => item.value === settings.profile)
      ?.detail ?? ""
  );
}

export function compactionSourceLabel(source: HarnessCompactionSource): string {
  return source === "conversation"
    ? "override for this conversation"
    : `inherited from ${source}`;
}

/** First problem with a compaction draft, using the contract's own bounds. */
export function compactionDraftError(
  draft: AutoCompactionSettings,
): string | undefined {
  const result = autoCompactionSettingsSchema.safeParse(draft);
  if (result.success) return undefined;
  const field = result.error.issues[0]?.path[0];
  return field === "customTriggerPercent"
    ? "Compact at must be a whole number from 60 to 90."
    : "Invalid compaction settings.";
}

export function compactionsEqual(
  a: AutoCompactionSettings,
  b: AutoCompactionSettings,
): boolean {
  return (
    a.auto === b.auto &&
    a.profile === b.profile &&
    a.customTriggerPercent === b.customTriggerPercent
  );
}

export const INSTRUCTIONS_MAX_BYTES = SUBAGENT_INSTRUCTIONS_MAX_BYTES;

export function instructionsBytes(text: string): number {
  return utf8ByteLength(text);
}

export function instructionsOverLimit(text: string): boolean {
  return utf8ByteLength(text) > INSTRUCTIONS_MAX_BYTES;
}

export function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** Empty or whitespace-only text clears the instructions. */
export function instructionsPatch(text: string): string | null {
  return text.trim() ? text : null;
}
