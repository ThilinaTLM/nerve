import type { ModelSelection } from "@nervekit/contracts/models";
import { thinkingLevelShortLabel } from "$lib/presentation/state/thinking-levels";
import {
  toolRows,
  toolSummary,
  type ToolId,
  type ToolPayload,
} from "../tools/tool-settings";
import type { ChangeRow, ModelChangeValue } from "./profile-changes";

/** What turning a change's stored value into words needs from the page. */
export type ChangeTextDeps = {
  modelName: (selection: ModelSelection) => string;
  permissionName: (id: string) => string;
  profileLabel: (name: string) => string;
};

/** The row's name: a tool by its label, otherwise the change's own label. */
export function changeRowLabel(row: ChangeRow): string {
  if (!row.key.startsWith("tool:")) return row.label;
  return (
    toolRows.find((tool) => tool.id === row.key.slice(5))?.label ?? row.label
  );
}

/** The value of one change in words ("Supervised", "On · after approval: Coding"). */
export function changeValueText(row: ChangeRow, deps: ChangeTextDeps): string {
  if (row.key === "model") {
    const value = row.value as ModelChangeValue;
    const name = value.model ? deps.modelName(value.model) : "Default";
    return value.thinking
      ? `${name} (${thinkingLevelShortLabel(value.thinking)})`
      : name;
  }
  if (row.key === "compaction") {
    const value = row.value as {
      auto?: boolean;
      profile?: string;
      customTriggerPercent?: number;
    };
    return value.auto === false
      ? "Off"
      : value.profile === "custom"
        ? `At ${value.customTriggerPercent}%`
        : (value.profile ?? "Use settings");
  }
  if (row.key.startsWith("skill:")) return row.value ? "On" : "Off";
  if (row.key === "permission") return deps.permissionName(String(row.value));
  if (row.key === "instructions") return String(row.value);
  return toolSummary(row.key.slice(5) as ToolId, row.value as ToolPayload, {
    profileLabel: deps.profileLabel,
  });
}

/**
 * One status line for a list row: the first two changes in short, then how many
 * more, or "Uses your defaults". Instructions are long text, so they only count.
 */
export function changeSummary(rows: ChangeRow[], deps: ChangeTextDeps): string {
  if (rows.length === 0) return "Uses your defaults";
  const shown = rows
    .filter((row) => row.key !== "instructions")
    .slice(0, 2)
    .map(
      (row) =>
        `${changeRowLabel(row)} ${changeValueText(row, deps).split(" · ")[0]}`,
    );
  const rest = rows.length - shown.length;
  return [
    ...shown,
    rest > 0 ? `${rest} more change${rest === 1 ? "" : "s"}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
