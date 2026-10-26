import type { ProfileTransitionPreview } from "@nervekit/contracts/agent-configuration";
import { sourceLabel } from "$lib/presentation/settings/configuration-source";
export function profileChangeValue(value: unknown): string {
  return value === undefined || value === null
    ? "Use settings"
    : typeof value === "string"
      ? value || "(empty)"
      : JSON.stringify(value);
}
/** Value-equal changes can still change policy: make the provenance transition visible. */
export function profileChangeSummary(
  row: ProfileTransitionPreview["changedFields"][number],
): string {
  const before = profileChangeValue(row.before),
    after = profileChangeValue(row.after);
  if (before !== after) return `${before} → ${after}`;
  return `${after} · ${sourceLabel(row.beforeSource)} → ${sourceLabel(row.afterSource)}`;
}
