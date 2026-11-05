import { indentUnit } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";

export type CodeIndentation = {
  unit: string;
  tabSize: number;
  label: string;
};

const DEFAULT_INDENTATION: CodeIndentation = {
  unit: "  ",
  tabSize: 4,
  label: "Spaces: 2",
};

function spaces(width: number): CodeIndentation {
  return { unit: " ".repeat(width), tabSize: width, label: `Spaces: ${width}` };
}

/** Infers the file's indentation from its first lines: tabs when tab-indented
 * lines dominate, otherwise the most common indentation step between lines.
 * Block-comment continuation lines (` * `) are ignored so they don't read as
 * one-space indentation. */
export function detectIndentation(
  text: string,
  maxLines = 2_000,
): CodeIndentation {
  let tabLines = 0;
  let spaceLines = 0;
  let previous = 0;
  const steps = new Map<number, number>();

  let start = 0;
  for (let index = 0; index < maxLines && start <= text.length; index += 1) {
    const newline = text.indexOf("\n", start);
    const end = newline === -1 ? text.length : newline;
    let width = 0;
    let position = start;
    const first = text.charCodeAt(position);
    if (first === 9) {
      while (text.charCodeAt(position) === 9) position += 1;
    } else {
      while (text.charCodeAt(position) === 32) {
        position += 1;
        width += 1;
      }
    }
    const content = text.slice(position, end).trimEnd();
    if (content && !content.startsWith("*")) {
      if (first === 9) {
        tabLines += 1;
      } else {
        if (width > 0) spaceLines += 1;
        const step = Math.abs(width - previous);
        if (step > 0 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
        previous = width;
      }
    }
    if (newline === -1) break;
    start = newline + 1;
  }

  if (tabLines > spaceLines) return { unit: "\t", tabSize: 4, label: "Tabs" };
  if (spaceLines === 0) return DEFAULT_INDENTATION;

  let best = 0;
  let bestCount = 0;
  for (const [step, count] of steps) {
    // One-space steps are usually alignment, not indentation.
    const weighted = step === 1 ? count / 4 : count;
    if (weighted > bestCount || (weighted === bestCount && step < best)) {
      best = step;
      bestCount = weighted;
    }
  }
  return best > 0 ? spaces(best) : DEFAULT_INDENTATION;
}

export function indentationExtension(indentation: CodeIndentation): Extension {
  return [
    indentUnit.of(indentation.unit),
    EditorState.tabSize.of(indentation.tabSize),
  ];
}
