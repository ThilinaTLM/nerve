import {
  getOriginalDoc,
  unifiedMergeView,
  updateOriginalDoc,
} from "@codemirror/merge";
import {
  ChangeSet,
  type EditorState,
  type Extension,
  type StateEffect,
  Text,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const unsavedChangesTheme = EditorView.theme({
  "&.cm-merge-b .cm-changedLine, &.cm-merge-b .cm-inlineChangedLine": {
    backgroundColor: "transparent",
  },
  "&.cm-merge-b .cm-changedText, &.cm-merge-b .cm-deletedText": {
    background: "none",
  },
  "&.cm-merge-b .cm-deletedChunk": {
    display: "none",
    backgroundColor: "transparent",
  },
  "&.cm-merge-b .cm-changedLineGutter": {
    backgroundColor: "var(--info)",
  },
  "&.cm-merge-b .cm-deletedLineGutter": {
    backgroundColor: "var(--destructive)",
  },
});

export function unsavedChangesExtension(originalText: string): Extension {
  return [
    unifiedMergeView({
      original: originalText,
      gutter: true,
      highlightChanges: false,
      syntaxHighlightDeletions: false,
      mergeControls: false,
    }),
    unsavedChangesTheme,
  ];
}

export function updateUnsavedChangesBaseline(
  state: EditorState,
  text: string,
): StateEffect<{ doc: Text; changes: ChangeSet }> {
  const original = getOriginalDoc(state);
  const doc = Text.of(text.split(/\r?\n/));
  const changes = ChangeSet.of(
    { from: 0, to: original.length, insert: doc },
    original.length,
  );
  return updateOriginalDoc.of({ doc, changes });
}
