import {
  type EditorState,
  type Extension,
  type Range,
  type TransactionSpec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import type { ComposerReference } from "./composer-editor-api";

/** One accepted mention: `[from, to)` in the document is the serialized text. */
export type MentionChip = {
  from: number;
  to: number;
  kind: ComposerReference["kind"];
  label: string;
  /** Full path/URL shown on hover. */
  title?: string;
};

type MentionChipState = {
  chips: readonly MentionChip[];
  decorations: DecorationSet;
};

/**
 * Register chips for text that is already in the document. Positions refer to
 * the document *after* the transaction carrying the effect. Overlapping
 * existing chips are replaced.
 */
export const addMentionEffect = StateEffect.define<MentionChip>();

// Same Lucide path data as the suggestion popup (composer-editor-completions).
const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  file: [
    "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
    "M14 2v5a1 1 0 0 0 1 1h5",
  ],
  folder: [
    "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  ],
  image: [
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",
    "M9 7a2 2 0 1 0 0 4 2 2 0 0 0 0-4",
    "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",
  ],
  launch: ["M4 17l6-6-6-6", "M12 19h8"],
  skill: [
    "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z",
  ],
  tool: [
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z",
  ],
  agent: [
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",
    "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
    "M16 3.128a4 4 0 0 1 0 7.744",
    "M22 21v-2a4 4 0 0 0-3-3.87",
  ],
  issue: ["M12 8v4", "M12 16h.01", "M22 12a10 10 0 1 0-20 0 10 10 0 0 0 20 0"],
  pullRequest: [
    "M18 15v-3a4 4 0 0 0-4-4h-4",
    "M14 5l-3 3 3 3",
    "M6 3v12",
    "M3 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0",
  ],
  command: ["m4 17 6-6-6-6", "m12 19 8 0"],
} as const;

type IconName = keyof typeof ICONS;

function iconFor(kind: MentionChip["kind"]): IconName {
  switch (kind) {
    case "file":
      return "file";
    case "directory":
      return "folder";
    case "image":
      return "image";
    case "pull_request":
      return "pullRequest";
    case "issue":
      return "issue";
    case "skill":
      return "skill";
    case "tool":
      return "tool";
    case "subagent":
    case "subagent_profile":
      return "agent";
    case "launch":
    case "launch_definition":
      return "launch";
    default:
      return "command";
  }
}

/** Icon colour classes mirror the popup: file success, directory/image info. */
function toneFor(kind: MentionChip["kind"]): string {
  if (kind === "file") return "cm-mention-chip-file";
  if (kind === "directory" || kind === "image") return "cm-mention-chip-info";
  return "";
}

function createIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "cm-mention-chip-icon");
  for (const d of ICONS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

class MentionChipWidget extends WidgetType {
  constructor(
    readonly kind: MentionChip["kind"],
    readonly label: string,
    readonly title: string | undefined,
  ) {
    super();
  }

  override eq(other: MentionChipWidget): boolean {
    return (
      other.kind === this.kind &&
      other.label === this.label &&
      other.title === this.title
    );
  }

  override toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = `cm-mention-chip ${toneFor(this.kind)}`.trim();
    chip.dataset.kind = this.kind;
    if (this.title) chip.title = this.title;
    const label = document.createElement("span");
    label.className = "cm-mention-chip-label";
    label.textContent = this.label;
    chip.append(createIcon(iconFor(this.kind)), label);
    return chip;
  }
}

function buildDecorations(chips: readonly MentionChip[]): DecorationSet {
  const ranges: Range<Decoration>[] = chips.map((chip) =>
    Decoration.replace({
      widget: new MentionChipWidget(chip.kind, chip.label, chip.title),
    }).range(chip.from, chip.to),
  );
  return Decoration.set(ranges, true);
}

function withChips(chips: readonly MentionChip[]): MentionChipState {
  return { chips, decorations: buildDecorations(chips) };
}

const mentionChipField = StateField.define<MentionChipState>({
  create: () => withChips([]),
  update(value, tr) {
    let chips = value.chips;
    let changed = false;
    if (tr.docChanged && chips.length > 0) {
      const edits: Array<[number, number]> = [];
      tr.changes.iterChangedRanges((fromA, toA) => edits.push([fromA, toA]));
      const next: MentionChip[] = [];
      for (const chip of chips) {
        // Any edit that deletes, replaces, or lands strictly inside the
        // mention text invalidates the chip; edits at its edges do not.
        const touched = edits.some(([fromA, toA]) =>
          fromA === toA
            ? fromA > chip.from && fromA < chip.to
            : fromA < chip.to && toA > chip.from,
        );
        if (touched) continue;
        next.push({
          ...chip,
          from: tr.changes.mapPos(chip.from, 1),
          to: tr.changes.mapPos(chip.to, -1),
        });
      }
      chips = next;
      changed = true;
    }
    for (const effect of tr.effects) {
      if (!effect.is(addMentionEffect)) continue;
      const added = effect.value;
      if (
        added.from >= added.to ||
        added.to > tr.newDoc.length ||
        added.from < 0
      ) {
        continue;
      }
      chips = [
        ...chips.filter(
          (chip) => chip.to <= added.from || chip.from >= added.to,
        ),
        added,
      ].sort((left, right) => left.from - right.from);
      changed = true;
    }
    return changed ? withChips(chips) : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
});

/** Current chips (sorted, non-overlapping). */
export function mentionChipsOf(state: EditorState): readonly MentionChip[] {
  return state.field(mentionChipField, false)?.chips ?? [];
}

/**
 * Atomic mention chips: decorations over the mention text only, so the
 * serialized document is untouched. Backspace/Delete remove a whole chip and
 * a chip is dropped when its text is edited partially.
 */
export function composerMentionChips(): Extension {
  return mentionChipField;
}

const isSpace = (char: string) => char === "" || /\s/.test(char);

/**
 * Insert each reference's `insert` text followed by a single space (no double
 * spaces, a leading space only when glued to previous text) and register chips
 * over the mention text. Replaces `range` (default: main selection).
 */
export function insertMentionsTransaction(
  state: EditorState,
  references: readonly ComposerReference[],
  range?: { from: number; to: number },
): TransactionSpec {
  const from = range?.from ?? state.selection.main.from;
  const to = range?.to ?? state.selection.main.to;
  const refs = references.filter((ref) => ref.insert.length > 0);
  if (refs.length === 0) return {};
  const before = from > 0 ? state.sliceDoc(from - 1, from) : "";
  const after = to < state.doc.length ? state.sliceDoc(to, to + 1) : "";

  let text = isSpace(before) ? "" : " ";
  const chips: MentionChip[] = [];
  for (const [index, ref] of refs.entries()) {
    const start = from + text.length;
    text += ref.insert;
    chips.push({
      from: start,
      to: start + ref.insert.length,
      kind: ref.kind,
      label: ref.label,
      title: ref.title,
    });
    if (index < refs.length - 1) text += " ";
  }
  const nextIsInlineSpace = after === " " || after === "\t";
  if (!nextIsInlineSpace) text += " ";
  const caret = from + text.length + (nextIsInlineSpace ? 1 : 0);

  return {
    changes: { from, to, insert: text },
    selection: { anchor: caret },
    effects: chips.map((chip) => addMentionEffect.of(chip)),
    userEvent: "input.complete",
    scrollIntoView: true,
  };
}
