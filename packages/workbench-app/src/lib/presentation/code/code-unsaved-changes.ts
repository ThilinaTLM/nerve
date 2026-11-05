import { Chunk } from "@codemirror/merge";
import {
  type EditorState,
  type Extension,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";

export type UnsavedLineKind =
  | "added"
  | "modified"
  | "deleted-above"
  | "deleted-below";

type UnsavedChanges = {
  baseline: Text;
  chunks: readonly Chunk[];
  markers: RangeSet<GutterMarker>;
};

const diffConfig = { scanLimit: 500 };

class UnsavedMarker extends GutterMarker {
  constructor(readonly kind: UnsavedLineKind) {
    super();
    this.elementClass = `cm-unsaved-${kind}`;
  }
}

const markers: Record<UnsavedLineKind, UnsavedMarker> = {
  added: new UnsavedMarker("added"),
  modified: new UnsavedMarker("modified"),
  "deleted-above": new UnsavedMarker("deleted-above"),
  "deleted-below": new UnsavedMarker("deleted-below"),
};

const setBaseline = StateEffect.define<Text>();

/** Line markers for unsaved chunks, in document order. */
export function unsavedLineMarkers(
  baseline: Text,
  doc: Text,
  chunks: readonly Chunk[],
): Array<{ line: number; kind: UnsavedLineKind }> {
  const result: Array<{ line: number; kind: UnsavedLineKind }> = [];
  for (const chunk of chunks) {
    const trailing = isTrailingDeletion(baseline, doc, chunk);
    if (trailing || (chunk.fromB === chunk.toB && chunk.fromB >= doc.length)) {
      // Removed text at the end of the document: mark the last line's bottom.
      const line = doc.lines;
      if (result.at(-1)?.line !== line)
        result.push({ line, kind: "deleted-below" });
      continue;
    }
    if (chunk.fromB === chunk.toB) {
      // A pure deletion sits between lines: mark the top of the line after it.
      result.push({
        line: doc.lineAt(chunk.fromB).number,
        kind: "deleted-above",
      });
      continue;
    }
    const kind = chunk.fromA === chunk.toA ? "added" : "modified";
    const first = doc.lineAt(chunk.fromB).number;
    const last = doc.lineAt(Math.min(chunk.endB, doc.length)).number;
    for (let line = first; line <= last; line += 1) {
      if (result.at(-1)?.line === line) result.pop();
      result.push({ line, kind });
    }
  }
  return result;
}

/** Removing the last lines also removes the newline of the line before them,
 * which diffs as a modified line; show it as the deletion it is. */
function isTrailingDeletion(baseline: Text, doc: Text, chunk: Chunk): boolean {
  if (
    chunk.toB <= doc.length ||
    chunk.toA - chunk.fromA <= chunk.toB - chunk.fromB
  )
    return false;
  const kept = doc.sliceString(chunk.fromB, doc.length);
  return (
    baseline.sliceString(chunk.fromA, chunk.fromA + kept.length + 1) ===
    `${kept}\n`
  );
}

function build(
  baseline: Text,
  doc: Text,
  chunks: readonly Chunk[],
): UnsavedChanges {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const { line, kind } of unsavedLineMarkers(baseline, doc, chunks)) {
    const from = doc.line(line).from;
    builder.add(from, from, markers[kind]);
  }
  return { baseline, chunks, markers: builder.finish() };
}

/* Chunks update incrementally around each edit (`Chunk.updateB`), so typing
 * cost depends on the edit, not the document. No deletion widgets or line
 * decorations are built; the only output is the gutter lane. */
const unsavedField = StateField.define<UnsavedChanges | null>({
  create: () => null,
  update(value, transaction) {
    if (!value) return value;
    for (const effect of transaction.effects) {
      if (effect.is(setBaseline)) {
        return build(
          effect.value,
          transaction.newDoc,
          Chunk.build(effect.value, transaction.newDoc, diffConfig),
        );
      }
    }
    if (!transaction.docChanged) return value;
    const chunks = Chunk.updateB(
      value.chunks,
      value.baseline,
      transaction.newDoc,
      transaction.changes,
      diffConfig,
    );
    return build(value.baseline, transaction.newDoc, chunks);
  },
});

// Bars are pseudo-elements so the active-line gutter background can't hide them.
const unsavedTheme = EditorView.theme({
  ".cm-unsavedGutter .cm-gutterElement": {
    position: "relative",
    // Wide enough for the deletion triangle; CodeMirror clips each gutter.
    width: "6px",
    padding: "0",
    marginLeft: "calc(var(--spacing) * 0.5)",
  },
  ".cm-unsavedGutter .cm-gutterElement::before": {
    position: "absolute",
    zIndex: "1",
    pointerEvents: "none",
  },
  ".cm-unsavedGutter .cm-unsaved-added::before, .cm-unsavedGutter .cm-unsaved-modified::before":
    { content: "''", top: "0", bottom: "0", left: "0", width: "3px" },
  ".cm-unsavedGutter .cm-unsaved-added::before": {
    backgroundColor: "var(--success)",
  },
  ".cm-unsavedGutter .cm-unsaved-modified::before": {
    backgroundColor: "var(--info)",
  },
  // Deletions point into the text at the boundary where lines were removed.
  ".cm-unsavedGutter .cm-unsaved-deleted-above::before, .cm-unsavedGutter .cm-unsaved-deleted-below::before":
    {
      content: "''",
      left: "0",
      borderTop: "4px solid transparent",
      borderBottom: "4px solid transparent",
      borderLeft: "6px solid var(--destructive-solid)",
    },
  ".cm-unsavedGutter .cm-unsaved-deleted-above::before": { top: "-4px" },
  ".cm-unsavedGutter .cm-unsaved-deleted-below::before": { bottom: "-4px" },
});

export function unsavedChangesExtension(originalText: string): Extension {
  return [
    unsavedField.init((state) => {
      const baseline = state.toText(originalText);
      return build(
        baseline,
        state.doc,
        Chunk.build(baseline, state.doc, diffConfig),
      );
    }),
    gutter({
      class: "cm-unsavedGutter",
      markers: (view) =>
        view.state.field(unsavedField, false)?.markers ?? RangeSet.empty,
    }),
    unsavedTheme,
  ];
}

export function unsavedChangeChunks(state: EditorState): readonly Chunk[] {
  return state.field(unsavedField, false)?.chunks ?? [];
}

export function unsavedMarkersOf(
  state: EditorState,
): Array<{ line: number; kind: UnsavedLineKind }> {
  const value = state.field(unsavedField, false);
  return value
    ? unsavedLineMarkers(value.baseline, state.doc, value.chunks)
    : [];
}

export function updateUnsavedChangesBaseline(
  state: EditorState,
  text: string,
): StateEffect<Text> {
  return setBaseline.of(state.toText(text));
}
