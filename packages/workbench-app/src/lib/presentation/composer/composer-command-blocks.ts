import { type EditorState } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { findExecutableCommandBlocks } from "@nervekit/contracts/completions";

export function executableCommandBlockDecorations(
  state: EditorState,
): DecorationSet {
  const ranges = [];
  const blockLine = Decoration.line({
    class: "cm-executable-command-block-line",
  });
  const commandMark = Decoration.mark({
    class: "cm-executable-command-block-command",
  });
  for (const block of findExecutableCommandBlocks(state.doc.toString())) {
    let position = block.start;
    while (position < block.end) {
      const line = state.doc.lineAt(position);
      ranges.push(blockLine.range(line.from));
      if (line.to >= block.end) break;
      position = line.to + 1;
    }
    if (block.commandEnd > block.commandStart) {
      ranges.push(commandMark.range(block.commandStart, block.commandEnd));
    }
  }
  return Decoration.set(
    ranges.sort((left, right) => left.from - right.from || left.to - right.to),
    true,
  );
}

export const executableCommandBlockHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: import("@codemirror/view").EditorView) {
      this.decorations = executableCommandBlockDecorations(view.state);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.decorations = executableCommandBlockDecorations(update.state);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);
