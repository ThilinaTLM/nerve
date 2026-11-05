import {
  type Chunk,
  getChunks,
  getOriginalDoc,
  type MergeConfig,
  unifiedMergeView,
  updateOriginalDoc,
} from "@codemirror/merge";
import {
  ChangeSet,
  EditorSelection,
  type EditorState,
  type Extension,
  type Text,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  type OverviewMark,
  type OverviewMarkSource,
  overviewMarkSource,
} from "./code-overview-ruler";

export type DiffLayout = "unified" | "split";

/** Shared by unified and split layouts. Unchanged stretches collapse; the
 * diff gives up on precision after a time budget instead of freezing. */
export const diffMergeConfig = {
  highlightChanges: true,
  gutter: true,
  collapseUnchanged: { margin: 3, minSize: 6 },
  diffConfig: { scanLimit: 2_000, timeout: 500 },
} satisfies MergeConfig;

const diffTheme = EditorView.theme({
  "&.cm-merge-b .cm-changedLine, &.cm-merge-b .cm-inlineChangedLine": {
    backgroundColor: "var(--success-subtle)",
  },
  "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
    color: "var(--foreground)",
    backgroundColor: "var(--destructive-subtle)",
  },
  "&.cm-merge-b .cm-changedText": {
    background: "var(--success-strong)",
  },
  "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": {
    background: "var(--destructive-strong)",
  },
  ".cm-changeGutter": {
    width: "calc(3px + var(--spacing) * 0.5)",
    paddingLeft: "calc(var(--spacing) * 0.5)",
  },
  ".cm-changeGutter .cm-gutterElement": { padding: "0" },
  // Scoped to the change gutter so the active-line gutter can't override it.
  "&.cm-merge-b .cm-changeGutter .cm-changedLineGutter": {
    backgroundColor: "var(--success)",
  },
  "&.cm-merge-a .cm-changeGutter .cm-changedLineGutter, .cm-changeGutter .cm-deletedLineGutter":
    { backgroundColor: "var(--destructive-solid)" },
  ".cm-changeGutter .cm-inlineChangedLineGutter": {
    backgroundColor: "var(--info)",
  },
  ".cm-collapsedLines": {
    padding: "calc(var(--spacing) * 0.5) calc(var(--spacing) * 3)",
    color: "var(--muted-foreground)",
    background: "var(--muted)",
    fontFamily: "var(--font-sans)",
    fontSize: "var(--text-ui)",
    cursor: "pointer",
  },
  ".cm-collapsedLines:hover": {
    color: "var(--foreground)",
    background: "var(--hover)",
  },
  ".cm-collapsedLines::before, .cm-collapsedLines::after": {
    content: "none",
  },
  ".cm-mergeSpacer": { background: "var(--muted)" },
});

function chunkRange(chunk: Chunk, side: "a" | "b") {
  return side === "a"
    ? {
        from: chunk.fromA,
        to: chunk.toA,
        end: chunk.endA,
        empty: chunk.fromA === chunk.toA,
      }
    : {
        from: chunk.fromB,
        to: chunk.toB,
        end: chunk.endB,
        empty: chunk.fromB === chunk.toB,
      };
}

function diffChunks(state: EditorState) {
  const result = getChunks(state);
  return result
    ? { chunks: result.chunks, side: result.side ?? "b" }
    : undefined;
}

/** Overview marks for a diff side: changed ranges, or a tick where the other
 * side has lines this side doesn't. */
export const diffOverviewMarks: OverviewMarkSource = (state) => {
  const diff = diffChunks(state);
  if (!diff) return [];
  const otherSide = diff.side === "a" ? "b" : "a";
  return diff.chunks.map((chunk): OverviewMark => {
    const own = chunkRange(chunk, diff.side);
    const other = chunkRange(chunk, otherSide);
    if (own.empty) {
      const position = Math.min(own.from, state.doc.length);
      return {
        from: position,
        to: position,
        kind: diff.side === "a" ? "added" : "deleted",
      };
    }
    const kind = other.empty
      ? diff.side === "a"
        ? "deleted"
        : "added"
      : "modified";
    return { from: own.from, to: Math.min(own.end, state.doc.length), kind };
  });
};

/** Unified diff of the editor document against `original`. */
export function unifiedDiffExtensions(original: string): Extension {
  return [
    unifiedMergeView({
      original,
      ...diffMergeConfig,
      syntaxHighlightDeletions: true,
      allowInlineDiffs: true,
      mergeControls: false,
    }),
    diffTheme,
    overviewMarkSource.of(diffOverviewMarks),
  ];
}

/** Per-side extensions for a split (`MergeView`) diff. */
export function splitDiffSideExtensions(): Extension {
  return [diffTheme, overviewMarkSource.of(diffOverviewMarks)];
}

export function updateUnifiedOriginal(view: EditorView, original: string) {
  const current = getOriginalDoc(view.state);
  const doc = view.state.toText(original);
  if (current.eq(doc)) return;
  view.dispatch({
    effects: updateOriginalDoc.of({
      doc,
      changes: ChangeSet.of(
        { from: 0, to: current.length, insert: doc },
        current.length,
      ),
    }),
  });
}

export type DiffPosition = { current?: number; total: number };

/** Which change (1-based) the cursor is in, and how many there are. */
export function diffChunkPosition(state: EditorState): DiffPosition {
  const diff = diffChunks(state);
  if (!diff) return { total: 0 };
  const head = state.selection.main.head;
  const index = diff.chunks.findIndex((chunk) => {
    const range = chunkRange(chunk, diff.side);
    return head >= range.from && head <= Math.max(range.end, range.from);
  });
  return {
    current: index === -1 ? undefined : index + 1,
    total: diff.chunks.length,
  };
}

/** Index of the change to move to from `head`, wrapping around the ends. */
export function nextChunkIndex(
  starts: readonly number[],
  head: number,
  current: number | undefined,
  direction: 1 | -1,
): number | undefined {
  if (!starts.length) return undefined;
  if (current !== undefined)
    return (current + direction + starts.length) % starts.length;
  if (direction > 0) {
    const next = starts.findIndex((start) => start > head);
    return next === -1 ? 0 : next;
  }
  for (let index = starts.length - 1; index >= 0; index -= 1)
    if ((starts[index] ?? 0) < head) return index;
  return starts.length - 1;
}

/** Moves the cursor to the next or previous change and centers it. */
export function stepDiffChunk(view: EditorView, direction: 1 | -1): boolean {
  const diff = diffChunks(view.state);
  if (!diff?.chunks.length) return false;
  const starts = diff.chunks.map((chunk) =>
    Math.min(chunkRange(chunk, diff.side).from, view.state.doc.length),
  );
  const current = diffChunkPosition(view.state).current;
  const index = nextChunkIndex(
    starts,
    view.state.selection.main.head,
    current === undefined ? undefined : current - 1,
    direction,
  );
  if (index === undefined) return false;
  const position = starts[index] ?? 0;
  view.dispatch({
    selection: EditorSelection.cursor(position),
    effects: EditorView.scrollIntoView(position, { y: "center" }),
  });
  return true;
}

export type DiffLineStats = { added: number; removed: number };

function lineSpan(doc: Text, from: number, to: number, end: number): number {
  if (to <= from) return 0;
  const last = Math.min(end, doc.length);
  return (
    doc.lineAt(last).number - doc.lineAt(Math.min(from, doc.length)).number + 1
  );
}

/** Added and removed line counts across all changes. */
export function diffLineStats(
  chunks: readonly Chunk[],
  original: Text,
  modified: Text,
): DiffLineStats {
  let added = 0;
  let removed = 0;
  for (const chunk of chunks) {
    added += lineSpan(modified, chunk.fromB, chunk.toB, chunk.endB);
    removed += lineSpan(original, chunk.fromA, chunk.toA, chunk.endA);
  }
  return { added, removed };
}
