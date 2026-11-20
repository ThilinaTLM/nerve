import type {
  AttentionEntry,
  AttentionTarget,
} from "$lib/application/configuration-attention/configuration-attention";
import type { ConfigurationAttentionRow } from "$lib/presentation/activity/ConfigurationAttentionItem.svelte";

export type AttentionHandlers = {
  /** The project the entries were read for; project items need it. */
  projectId: string | undefined;
  onOpenTarget: (target: AttentionTarget) => void;
  onAskAgent: (entry: AttentionEntry) => void;
  onOpenFile: (path: string) => void;
};

/**
 * One row per entry. A waiting item offers Review, a broken one the agent's
 * help and where to look; neither approves anything.
 */
export function attentionRows(
  entries: readonly AttentionEntry[],
  handlers: AttentionHandlers,
): ConfigurationAttentionRow[] {
  return entries.map((entry) => {
    const { target, path, askAgent } = entry;
    const actions: ConfigurationAttentionRow["actions"] = [];
    if (entry.group === "review") {
      if (target)
        actions.push({
          label: "Review",
          onSelect: () => handlers.onOpenTarget(target),
        });
    } else {
      if (askAgent && handlers.projectId)
        actions.push({
          label:
            askAgent === "upgrade"
              ? "Ask the agent to upgrade"
              : "Ask the agent to fix",
          onSelect: () => handlers.onAskAgent(entry),
        });
      if (target)
        actions.push({
          label: "Details",
          onSelect: () => handlers.onOpenTarget(target),
        });
      else if (path && entry.scope === "project")
        actions.push({
          label: "Open file",
          onSelect: () => handlers.onOpenFile(path),
        });
    }
    return {
      key: entry.key,
      group: entry.group,
      title: entry.title,
      ...(path ? { titleHint: path } : {}),
      context: entry.origin,
      detail: entry.detail,
      actions,
    };
  });
}
