import {
  type EditorState,
  type Extension,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  keymap,
} from "@codemirror/view";
import type {
  ComposerDictationHandle,
  ComposerDictationState,
} from "./composer-editor-api";

type Placeholder = {
  /** Position in the document; the widget occupies no document text. */
  pos: number;
  state: ComposerDictationState;
  elapsedMs: number;
};

const setPlaceholder = StateEffect.define<Placeholder>();
const updatePlaceholder = StateEffect.define<{
  state: ComposerDictationState;
  elapsedMs: number;
}>();
/** Removal requested by the host (resolve/cancel). */
const clearPlaceholder = StateEffect.define<null>();
/** Removal requested by the user pressing Backspace next to the chip. */
const removePlaceholder = StateEffect.define<null>();

const LABELS: Record<ComposerDictationState, string> = {
  recording: "Listening",
  transcribing: "Transcribing",
  failed: "Failed",
};

const TITLES: Record<ComposerDictationState, string> = {
  recording: "Recording — click the mic to finish, Esc to cancel",
  transcribing: "Transcribing — Esc to cancel",
  failed: "Transcription failed — click the mic to retry, Esc to discard",
};

function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

class DictationWidget extends WidgetType {
  constructor(
    readonly state: ComposerDictationState,
    readonly time: string,
  ) {
    super();
  }

  override eq(other: DictationWidget): boolean {
    return other.state === this.state && other.time === this.time;
  }

  override toDOM(): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "cm-mention-chip cm-dictation-chip";
    chip.setAttribute("role", "status");
    const icon = document.createElement("span");
    icon.className = "cm-dictation-icon";
    const label = document.createElement("span");
    label.className = "cm-dictation-label";
    const time = document.createElement("span");
    time.className = "cm-dictation-time";
    chip.append(icon, label, time);
    this.paint(chip);
    return chip;
  }

  override updateDOM(dom: HTMLElement): boolean {
    this.paint(dom);
    return true;
  }

  private paint(chip: HTMLElement): void {
    chip.dataset.dictation = this.state;
    chip.title = TITLES[this.state];
    const label = chip.querySelector(".cm-dictation-label");
    const time = chip.querySelector(".cm-dictation-time");
    if (label) label.textContent = LABELS[this.state];
    if (time) time.textContent = this.time;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const placeholderField = StateField.define<Placeholder | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    if (next && tr.docChanged) {
      let crossed = false;
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA < next!.pos && toA > next!.pos) crossed = true;
      });
      // Typing at the chip's position goes after it, so the caret stays put.
      next = crossed ? null : { ...next, pos: tr.changes.mapPos(next.pos, -1) };
    }
    for (const effect of tr.effects) {
      if (effect.is(setPlaceholder)) next = effect.value;
      else if (effect.is(updatePlaceholder) && next) {
        next = { ...next, ...effect.value };
      } else if (effect.is(clearPlaceholder) || effect.is(removePlaceholder)) {
        next = null;
      }
    }
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(
      field,
      (value): DecorationSet =>
        value
          ? Decoration.set([
              Decoration.widget({
                widget: new DictationWidget(
                  value.state,
                  formatElapsed(value.elapsedMs),
                ),
                side: -1,
              }).range(value.pos),
            ])
          : Decoration.none,
    ),
});

/**
 * Whether the user ever placed a caret or typed. A freshly created editor
 * reports selection 0 even though no caret exists; dictation then goes to the
 * end of the document.
 */
const caretPlacedField = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) =>
    value ||
    tr.isUserEvent("select") ||
    tr.isUserEvent("input") ||
    tr.isUserEvent("delete") ||
    tr.isUserEvent("move") ||
    tr.isUserEvent("undo") ||
    tr.isUserEvent("redo"),
});

type InternalHandle = ComposerDictationHandle & {
  listeners: Set<() => void>;
};

const handles = new WeakMap<EditorView, InternalHandle>();

const removalListener = EditorView.updateListener.of((update) => {
  const before = update.startState.field(placeholderField, false);
  const after = update.state.field(placeholderField, false);
  if (!before || after) return;
  const handle = handles.get(update.view);
  handles.delete(update.view);
  if (!handle) return;
  const requested = update.transactions.some((tr) =>
    tr.effects.some((effect) => effect.is(clearPlaceholder)),
  );
  const listeners = [...handle.listeners];
  handle.listeners.clear();
  if (!requested) for (const listener of listeners) listener();
});

const removeOnBackspace = Prec.high(
  keymap.of([
    {
      key: "Backspace",
      run(view) {
        const placeholder = view.state.field(placeholderField, false);
        const selection = view.state.selection.main;
        if (
          !placeholder ||
          !selection.empty ||
          selection.head !== placeholder.pos
        ) {
          return false;
        }
        view.dispatch({ effects: removePlaceholder.of(null) });
        return true;
      },
    },
  ]),
);

/** Installs the placeholder widget field, Backspace removal, and tracking. */
export function composerDictationPlaceholder(): Extension {
  return [
    placeholderField,
    caretPlacedField,
    removalListener,
    removeOnBackspace,
  ];
}

/** Current placeholder position, if any (mainly for hosts and tests). */
export function dictationPlaceholderPosition(
  state: EditorState,
): number | undefined {
  return state.field(placeholderField, false)?.pos;
}

function createHandle(view: EditorView): InternalHandle {
  const listeners = new Set<() => void>();
  const handle: InternalHandle = {
    listeners,
    get active() {
      return (
        handles.get(view) === handle &&
        !!view.state.field(placeholderField, false)
      );
    },
    update(state, elapsedMs) {
      if (!handle.active) return;
      view.dispatch({ effects: updatePlaceholder.of({ state, elapsedMs }) });
    },
    resolve(text) {
      const placeholder = view.state.field(placeholderField, false);
      if (!handle.active || !placeholder) return;
      const trimmed = text.trim();
      if (!trimmed) {
        view.dispatch({ effects: clearPlaceholder.of(null) });
        return;
      }
      const { doc } = view.state;
      const pos = placeholder.pos;
      const before = pos > 0 ? doc.sliceString(pos - 1, pos) : "";
      const after = pos < doc.length ? doc.sliceString(pos, pos + 1) : "";
      const lead = before && !/\s/.test(before) ? " " : "";
      const tail = after && !/\s/.test(after) ? " " : "";
      const insert = `${lead}${trimmed}${tail}`;
      view.dispatch({
        changes: { from: pos, insert },
        selection: { anchor: pos + lead.length + trimmed.length + tail.length },
        effects: clearPlaceholder.of(null),
        userEvent: "input.dictation",
        scrollIntoView: true,
      });
    },
    cancel() {
      if (!handle.active) return;
      view.dispatch({ effects: clearPlaceholder.of(null) });
    },
    onRemoved(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return handle;
}

/**
 * Place the placeholder at the caret (replacing a non-empty selection, or at
 * the end of the document if no caret was ever placed). Returns the live
 * handle when one already exists.
 */
export function startDictation(view: EditorView): ComposerDictationHandle {
  const existing = handles.get(view);
  if (existing?.active) return existing;
  if (view.state.field(placeholderField, false) === undefined) {
    throw new Error(
      "composerDictationPlaceholder() extension is not installed",
    );
  }
  const { doc, selection } = view.state;
  const main = selection.main;
  const placed = view.state.field(caretPlacedField, false) ?? true;
  const from = main.empty && !placed ? doc.length : main.from;
  const to = main.empty && !placed ? doc.length : main.to;
  const handle = createHandle(view);
  handles.set(view, handle);
  view.dispatch({
    changes: from === to ? undefined : { from, to },
    selection: { anchor: from },
    effects: setPlaceholder.of({ pos: from, state: "recording", elapsedMs: 0 }),
    userEvent: from === to ? "select" : "delete.selection",
    scrollIntoView: true,
  });
  return handle;
}
