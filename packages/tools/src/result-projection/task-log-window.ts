import type { ExactContinuation, ProjectionCount } from "@nervekit/contracts";
import { ProjectionBudgetLedger } from "./budget-ledger.js";
import { profileBudget } from "./profiles.js";
import type {
  ProjectableBlock,
  ProjectionCandidate,
  SemanticItem,
} from "./types.js";

export type TaskLogWindowProjection = {
  blocks: ProjectableBlock[];
  counts: ProjectionCount[];
  continuation?: ExactContinuation[];
};

export function taskLogWindow(
  candidate: ProjectionCandidate,
): TaskLogWindowProjection {
  const budget = profileBudget("task_logs", "overflow");
  const items = candidate.items ?? [];
  const state = candidate.taskLog;
  if (!state)
    return { blocks: candidate.blocks, counts: candidate.counts ?? [] };
  const prefix = candidate.status ?? [];
  const ledger = new ProjectionBudgetLedger(budget);
  ledger.commit(prefix);
  ledger.commit(taskLogNotice(candidate, items, true));

  const indexed = items.map((item, index) => ({ item, index }));
  let ordered = indexed;
  if (["recent", "errors", "warnings"].includes(state.mode)) {
    ordered = [...indexed].reverse();
  } else if (state.mode === "first_failure" && state.failureSeq !== undefined) {
    const anchor = indexed.findIndex(
      ({ item }) => Number(item.id) === state.failureSeq,
    );
    if (anchor >= 0) {
      ordered = [indexed[anchor]!];
      for (let distance = 1; ordered.length < indexed.length; distance += 1) {
        const before = indexed[anchor - distance];
        const after = indexed[anchor + distance];
        if (before) ordered.push(before);
        if (after) ordered.push(after);
      }
    }
  }

  const selected: Array<{ item: SemanticItem; index: number }> = [];
  for (const entry of ordered) {
    if (ledger.commit(entry.item.blocks, true)) selected.push(entry);
  }
  selected.sort((left, right) => left.index - right.index);
  let selectedItems = selected.map(({ item }) => item);
  while (!taskLogOutputFits(candidate, prefix, selectedItems, budget)) {
    if (selectedItems.length === 0) break;
    selectedItems = ["recent", "errors", "warnings"].includes(state.mode)
      ? selectedItems.slice(1)
      : selectedItems.slice(0, -1);
  }
  return {
    blocks: combineAdjacentText([
      ...prefix,
      ...selectedItems.flatMap((item) => item.blocks),
      ...taskLogNotice(candidate, selectedItems, false),
    ]),
    counts: mergeEventCount(
      candidate.counts,
      state.originalEventCount,
      selectedItems.length,
    ),
    continuation: taskLogContinuation(candidate, selectedItems),
  };
}

function taskLogOutputFits(
  candidate: ProjectionCandidate,
  prefix: readonly ProjectableBlock[],
  selected: readonly SemanticItem[],
  budget: ReturnType<typeof profileBudget>,
): boolean {
  const ledger = new ProjectionBudgetLedger(budget);
  if (!ledger.commit(prefix)) return false;
  for (const item of selected) {
    if (!ledger.commit(item.blocks, true)) return false;
  }
  return ledger.commit(taskLogNotice(candidate, selected, false));
}

function taskLogNotice(
  candidate: ProjectionCandidate,
  selected: readonly SemanticItem[],
  reserve: boolean,
): ProjectableBlock[] {
  const state = candidate.taskLog;
  if (!state) return [];
  const first = Number(selected[0]?.id ?? 0);
  const last = Number(selected.at(-1)?.id ?? first);
  const displayed = reserve ? state.originalEventCount : selected.length;
  const omitted = Math.max(0, state.originalEventCount - displayed);
  const lines = [
    displayed > 0
      ? `Showing ${displayed} of ${state.originalEventCount} events (seq ${first}-${last}); ${omitted} omitted.`
      : `Showing 0 of ${state.originalEventCount} events; ${omitted} omitted.`,
  ];
  if (reserve) {
    lines.push(
      `For older events, call task_logs in ${state.mode} mode with cursor=${first}.`,
      `Continue incremental output with mode=since_cursor and cursor=${last}.`,
    );
    const path = eventIndexPath(candidate);
    if (path) lines.push(`Full event index: ${path} (use grep or read).`);
  }
  if (!reserve && displayed > 0) {
    if (["recent", "errors", "warnings"].includes(state.mode) && omitted > 0)
      lines.push(
        `For older events, call task_logs in ${state.mode} mode with cursor=${first}.`,
      );
    if (state.mode === "since_cursor" && (omitted > 0 || state.hasMoreAfter))
      lines.push(
        `Continue incremental output with mode=since_cursor and cursor=${last}.`,
      );
    else
      lines.push(
        `For future events, use mode=since_cursor with cursor=${last}.`,
      );
  }
  if (!reserve && state.mode === "first_failure" && omitted > 0) {
    const path = eventIndexPath(candidate);
    if (path) lines.push(`Full event index: ${path} (use grep or read).`);
  }
  return [{ type: "text", text: lines.join("\n") }];
}

function eventIndexPath(candidate: ProjectionCandidate): string | undefined {
  const id = candidate.taskLog?.eventsArtifactId;
  const artifact = candidate.artifacts.find(
    (item) =>
      item.id === id &&
      item.availability === "available" &&
      item.access.kind === "agent_file",
  );
  return artifact?.access.kind === "agent_file"
    ? artifact.access.path
    : undefined;
}

function taskLogContinuation(
  candidate: ProjectionCandidate,
  selected: readonly SemanticItem[],
): ExactContinuation[] {
  const state = candidate.taskLog;
  if (!state || selected.length === 0) return [];
  const first = Number(selected[0]?.id ?? 0);
  const last = Number(selected.at(-1)?.id ?? first);
  const output: ExactContinuation[] = [];
  if (
    ["recent", "errors", "warnings"].includes(state.mode) &&
    state.originalEventCount > selected.length
  )
    output.push({
      kind: "cursor",
      cursorName: "cursor",
      value: first,
      direction: "before",
    });
  if (state.mode !== "first_failure")
    output.push({
      kind: "cursor",
      cursorName: "cursor",
      value: last,
      direction: "after",
    });
  return output;
}

function mergeEventCount(
  counts: readonly ProjectionCount[] | undefined,
  original: number,
  displayed: number,
): ProjectionCount[] {
  return [
    ...(counts ?? []).filter((count) => count.kind !== "event"),
    {
      kind: "event",
      original,
      displayed,
      omitted: Math.max(0, original - displayed),
    },
  ];
}

function combineAdjacentText(
  blocks: readonly ProjectableBlock[],
): ProjectableBlock[] {
  const output: ProjectableBlock[] = [];
  for (const block of blocks) {
    const previous = output.at(-1);
    if (block.type === "text" && previous?.type === "text")
      previous.text = `${previous.text}\n${block.text}`;
    else output.push({ ...block });
  }
  return output;
}
