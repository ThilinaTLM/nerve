import type { ToolCallTranscriptRecord } from "$lib/api";
import {
  classifyHistoryEntry,
  type HistoryGraphRow,
  type HistoryIconName,
  type HistoryNodeType,
} from "./history-graph";

/**
 * Collapse layer on top of {@link HistoryGraphRow}s.
 *
 * A branching conversation is mostly linear with occasional forks. Showing
 * every tool call / result / assistant turn as its own row buries the few real
 * branch points in noise, so we fold maximal linear runs of "noise" entries
 * into a single collapsible segment. Anchors that carry meaning — user
 * messages, human-in-the-loop turns, branch points, leaves, the active entry,
 * and summaries — are never folded, so the tree's shape stays legible.
 *
 * Kept free of Svelte/component imports so it stays pure and unit-testable
 * under `node:test`.
 */

/** Minimum run length worth collapsing; shorter runs render inline. */
export const MIN_SEGMENT_RUN = 3;

/** Entry types eligible to be folded into a collapsed segment. */
const COLLAPSIBLE_TYPES = new Set<HistoryNodeType>([
  "assistant",
  "tool_call",
  "tool_result",
  "system",
]);

export type HistorySegmentPart = {
  icon: HistoryIconName;
  label: string;
  count: number;
};

export type HistorySegment = {
  /** Stable id = the head entry's id. */
  id: string;
  lane: number;
  headParentEntryId?: string;
  headParentLane?: number;
  rows: HistoryGraphRow[];
  isOnActivePath: boolean;
  total: number;
  parts: HistorySegmentPart[];
  startedAt: string;
  endedAt: string;
};

export type HistoryVisibleItem =
  | { type: "entry"; row: HistoryGraphRow }
  | { type: "segment"; segment: HistorySegment };

export type HistoryVisible = {
  items: HistoryVisibleItem[];
  /**
   * Maps every entry id (including those folded inside a collapsed segment) to
   * the visible-item index it renders at. Interior segment members resolve to
   * their segment's index so edge/dot geometry keyed on parent links keeps
   * working unchanged.
   */
  visibleIndexById: Map<string, number>;
  /** Every collapsible run (length >= MIN_SEGMENT_RUN), regardless of expansion. */
  segments: HistorySegment[];
};

function makeSegment(
  indices: number[],
  rows: HistoryGraphRow[],
  descByIndex: ReturnType<typeof classifyHistoryEntry>[],
): HistorySegment {
  const head = rows[indices[0]];
  const tail = rows[indices[indices.length - 1]];
  const counts = new Map<string, HistorySegmentPart>();
  for (const i of indices) {
    const desc = descByIndex[i];
    const existing = counts.get(desc.label);
    if (existing) existing.count += 1;
    else
      counts.set(desc.label, { icon: desc.icon, label: desc.label, count: 1 });
  }
  return {
    id: head.node.entry.id,
    lane: head.lane,
    headParentEntryId: head.node.entry.parentEntryId,
    headParentLane: head.parentLane,
    rows: indices.map((i) => rows[i]),
    isOnActivePath: indices.some((i) => rows[i].isOnActivePath),
    total: indices.length,
    parts: [...counts.values()].sort((a, b) => b.count - a.count),
    startedAt: head.node.entry.createdAt,
    endedAt: tail.node.entry.createdAt,
  };
}

/**
 * Build the ordered visible-item list for the branch rail by folding eligible
 * linear runs into segments. `expanded` holds the ids of segments the user has
 * opened (segment id = its head entry id).
 */
export function buildHistoryVisible(
  rows: HistoryGraphRow[],
  toolCallsById: Map<string, ToolCallTranscriptRecord>,
  expanded: Set<string>,
): HistoryVisible {
  const descByIndex = rows.map((row) =>
    classifyHistoryEntry(row.node.entry, toolCallsById),
  );

  const isCollapsible = (i: number): boolean => {
    const row = rows[i];
    return (
      !row.isActive &&
      !row.isLeaf &&
      !row.isBranchPoint &&
      COLLAPSIBLE_TYPES.has(descByIndex[i].type)
    );
  };

  // Partition the rows into ordered groups: standalone rows and maximal linear
  // runs of collapsible entries (same lane, contiguous parent chain).
  type Group =
    | { kind: "row"; index: number }
    | { kind: "run"; indices: number[] };
  const groups: Group[] = [];
  let run: number[] = [];
  const flushRun = () => {
    if (run.length) {
      groups.push({ kind: "run", indices: run });
      run = [];
    }
  };
  for (let i = 0; i < rows.length; i++) {
    if (!isCollapsible(i)) {
      flushRun();
      groups.push({ kind: "row", index: i });
      continue;
    }
    const prevIndex = run.at(-1);
    const prev = prevIndex === undefined ? undefined : rows[prevIndex];
    const linked =
      prev !== undefined &&
      rows[i].node.entry.parentEntryId === prev.node.entry.id &&
      rows[i].lane === prev.lane;
    if (run.length && !linked) flushRun();
    run.push(i);
  }
  flushRun();

  const items: HistoryVisibleItem[] = [];
  const segments: HistorySegment[] = [];
  const visibleIndexById = new Map<string, number>();

  const pushEntry = (index: number) => {
    visibleIndexById.set(rows[index].node.entry.id, items.length);
    items.push({ type: "entry", row: rows[index] });
  };

  for (const group of groups) {
    if (group.kind === "row") {
      pushEntry(group.index);
      continue;
    }
    if (group.indices.length < MIN_SEGMENT_RUN) {
      for (const index of group.indices) pushEntry(index);
      continue;
    }
    const segment = makeSegment(group.indices, rows, descByIndex);
    segments.push(segment);
    if (expanded.has(segment.id)) {
      for (const index of group.indices) pushEntry(index);
    } else {
      const visibleIndex = items.length;
      items.push({ type: "segment", segment });
      for (const index of group.indices) {
        visibleIndexById.set(rows[index].node.entry.id, visibleIndex);
      }
    }
  }

  return { items, visibleIndexById, segments };
}

/** Segments on the active branch start expanded; off-path segments collapsed. */
export function defaultExpandedSegments(
  segments: HistorySegment[],
): Set<string> {
  return new Set(
    segments
      .filter((segment) => segment.isOnActivePath)
      .map((segment) => segment.id),
  );
}

/** What the user has selected in the rail (drives the preview pane). */
export type HistorySelection =
  | { kind: "root" }
  | { kind: "entry"; row: HistoryGraphRow }
  | { kind: "segment"; segment: HistorySegment };

/** Stable highlight key for a selection. */
export function selectionKey(selection: HistorySelection): string {
  switch (selection.kind) {
    case "root":
      return "root";
    case "entry":
      return `e:${selection.row.node.entry.id}`;
    case "segment":
      return `s:${selection.segment.id}`;
  }
}
