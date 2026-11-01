<script lang="ts">
import { onDestroy, onMount } from "svelte";
import FileIcon from "@lucide/svelte/icons/file";
import Clipboard from "@lucide/svelte/icons/clipboard";
import Copy from "@lucide/svelte/icons/copy";
import Redo2 from "@lucide/svelte/icons/redo-2";
import Scissors from "@lucide/svelte/icons/scissors";
import TextSelect from "@lucide/svelte/icons/text-select";
import Undo2 from "@lucide/svelte/icons/undo-2";
import { markdown } from "@codemirror/lang-markdown";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  keymap,
  placeholder as placeholderExtension,
  type ViewUpdate,
} from "@codemirror/view";
import {
  isInlineCommandPrompt,
  type CompletionItem,
} from "@nervekit/contracts/completions";
import ContextMenuList, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import { contextSelection } from "$lib/presentation/code/codemirror-context-menu";
import { viewerShortcut } from "$lib/presentation/code/code-viewer-helpers";
import {
  formatProjectEntryReferences,
  hasProjectEntryDragType,
  parseProjectEntryDrag,
  PROJECT_ENTRY_DRAG_MIME,
} from "$lib/presentation/dnd/project-entry-drag";
import ComposerCompletionPopup from "./ComposerCompletionPopup.svelte";
import { executableCommandBlockHighlighter } from "./composer-command-blocks";
import { externalValueChange } from "./composer-external-value";
import { quoteBlockHighlighter } from "./composer-quote-blocks";
import {
  closeCompletion,
  composerCompletionController,
  composerCompletionExtensions,
  refreshComposerReferenceCompletions,
  invalidateComposerCompletionRequests,
  type ComposerCompletionAction,
  type ComposerCompletionOptions,
  type ComposerReferenceSource,
  type ComposerSlashContext,
  type PopupModel,
} from "./composer-editor-completions";
import {
  composerDictationPlaceholder,
  startDictation,
} from "./composer-dictation-placeholder";
import type {
  ComposerDictationHandle,
  ComposerEditorApi,
} from "./composer-editor-api";
import {
  composerMentionChips,
  insertMentionsTransaction,
} from "./composer-mention-chips";
import { pathMentionReference } from "./composer-path-references";
import { composerEditorTheme } from "./composer-editor-theme";
type Props = {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  focusToken?: number;
  slashCompletions?: readonly CompletionItem[];
  completionSource?: ComposerReferenceSource;
  /** Profile and run state for the slash list (`abort` only while running). */
  slashContext?: ComposerSlashContext;
  /** Runs a slash command immediately. Without it slash suggestions are off. */
  onSlashCommand?: (name: string) => void;
  /** Status-bar fix actions (connect a source, open settings…). */
  onCompletionAction?: (action: ComposerCompletionAction) => void;
  onReady?: (api: ComposerEditorApi) => void;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onPasteImage?: (file: File) => Promise<string>;
  onDropFiles?: (files: readonly File[]) => Promise<readonly string[]>;
  onReadClipboardText?: () => Promise<string>;
  onWriteClipboardText?: (text: string) => Promise<void>;
  onClipboardError?: (action: "copy" | "cut" | "paste") => void;
};

let {
  value,
  placeholder = "Ask the Nerve agent",
  ariaLabel = "Prompt editor drop area",
  disabled = false,
  focusToken = 0,
  slashCompletions = [],
  completionSource,
  slashContext,
  onSlashCommand,
  onCompletionAction,
  onReady,
  onChange,
  onSubmit,
  onPasteImage,
  onDropFiles,
  onReadClipboardText,
  onWriteClipboardText,
  onClipboardError,
}: Props = $props();

let host: HTMLDivElement;
let view: EditorView | undefined;
let editorValue = "";
let lastFocusToken = 0;
let fileDragDepth = 0;
let fileDragActive = $state(false);
let contextVersion = $state(0);
let popupModel = $state.raw<PopupModel | null>(null);
let shellMode = $state(false);
let root: HTMLDivElement | undefined = $state();
let caretPlaced = false;
let dictation:
  | {
      inner: ComposerDictationHandle;
      handle: ComposerDictationHandle;
      listeners: Set<() => void>;
    }
  | undefined;
const editableCompartment = new Compartment();
const completionCompartment = new Compartment();
const placeholderCompartment = new Compartment();

// Parent props may be getters into a composer model replaced on every edit.
// Deduplicate completion inputs before effects read them, so typing does not
// close/reconfigure autocomplete before its activation timer can run.
const completionSlashItems = $derived(slashCompletions);
const completionReferenceSource = $derived(completionSource);

const completionOptions: ComposerCompletionOptions = {
  referenceSource: () => completionReferenceSource,
  onModel: (model) => {
    popupModel = model;
  },
  slashContext: () => slashContext,
  slashCommand: () => onSlashCommand,
  action: () => onCompletionAction,
  slashCompletions: () => completionSlashItems,
};

function editableExtensions(isDisabled: boolean) {
  return [
    EditorState.readOnly.of(isDisabled),
    EditorView.editable.of(!isDisabled),
  ];
}

function submit() {
  if (disabled) return false;
  onSubmit?.();
  return true;
}

// The suggestion keymap runs first, so Enter only reaches here when no
// suggestion was accepted.
function submitOnEnter() {
  return submit();
}

// Esc with no popup open cancels a pending dictation placeholder; the host
// learns through the same `onRemoved` path as a user deleting the chip.
function cancelDictationOnEscape(): boolean {
  if (!dictation?.inner.active) return false;
  const { inner, listeners } = dictation;
  inner.cancel();
  for (const listener of [...listeners]) listener();
  listeners.clear();
  return true;
}

function startDictationFromApi(): ComposerDictationHandle {
  if (!view) throw new Error("Prompt editor is not ready");
  const inner = startDictation(view);
  if (dictation?.inner === inner) return dictation.handle;
  // Callback registry only; membership never drives rendered state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const listeners = new Set<() => void>();
  const handle: ComposerDictationHandle = {
    update: (state, elapsedMs) => inner.update(state, elapsedMs),
    resolve: (text) => inner.resolve(text),
    cancel: () => inner.cancel(),
    get active() {
      return inner.active;
    },
    onRemoved(listener) {
      listeners.add(listener);
      const off = inner.onRemoved(listener);
      return () => {
        listeners.delete(listener);
        off();
      };
    },
  };
  dictation = { inner, handle, listeners };
  return handle;
}

const editorApi: ComposerEditorApi = {
  insertReferences(references) {
    if (!view || disabled || references.length === 0) return;
    // Before a caret was ever placed the selection is the default position 0.
    const end = view.state.doc.length;
    view.dispatch({
      ...insertMentionsTransaction(
        view.state,
        references,
        caretPlaced ? undefined : { from: end, to: end },
      ),
      scrollIntoView: true,
    });
    view.focus();
  },
  startDictation: startDictationFromApi,
};

function pickSuggestion(id: string) {
  if (!view) return;
  composerCompletionController(view)?.accept(id);
  view.focus();
}

function insertAtRange(text: string, from?: number, to?: number) {
  if (!view || !text) return;
  const selection = view.state.selection.main;
  const docLength = view.state.doc.length;
  const insertFrom = Math.min(from ?? selection.from, docLength);
  const insertTo = Math.min(to ?? selection.to, docLength);
  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: text },
    selection: { anchor: insertFrom + text.length },
    scrollIntoView: true,
  });
  view.focus();
}

/** Insert path mentions as chips (`@path`), replacing `selection` when given. */
function insertPathMentions(
  paths: readonly string[],
  selection?: { from: number; to: number },
  hint?: "image",
): void {
  if (!view || paths.length === 0) return;
  const length = view.state.doc.length;
  const range = selection && {
    from: Math.min(selection.from, length),
    to: Math.min(selection.to, length),
  };
  view.dispatch(
    insertMentionsTransaction(
      view.state,
      paths.map((path) => pathMentionReference(path, hint)),
      range,
    ),
  );
  view.focus();
}

function hasNativeFileItems(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return (
    Array.from(dataTransfer.items).some((item) => item.kind === "file") ||
    Array.from(dataTransfer.types).includes("Files")
  );
}

function hasProjectEntryItems(dataTransfer: DataTransfer | null): boolean {
  return Boolean(
    dataTransfer && hasProjectEntryDragType(Array.from(dataTransfer.types)),
  );
}

function canHandleFileDrag(event: DragEvent): boolean {
  if (disabled) return false;
  return (
    hasProjectEntryItems(event.dataTransfer) ||
    Boolean(onDropFiles && hasNativeFileItems(event.dataTransfer))
  );
}

function handleFileDragEnter(event: DragEvent): void {
  if (!canHandleFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  fileDragDepth += 1;
  fileDragActive = true;
}

function handleFileDragOver(event: DragEvent): void {
  if (!canHandleFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}

function handleFileDragLeave(event: DragEvent): void {
  if (!fileDragActive) return;
  event.preventDefault();
  event.stopPropagation();
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (fileDragDepth === 0) fileDragActive = false;
}

function handleFileDrop(event: DragEvent): void {
  if (!canHandleFileDrag(event) || !view) return;
  event.preventDefault();
  event.stopPropagation();
  fileDragDepth = 0;
  fileDragActive = false;

  const { from, to } = view.state.selection.main;
  const internalPayload = event.dataTransfer?.getData(PROJECT_ENTRY_DRAG_MIME);
  if (internalPayload) {
    const entries = parseProjectEntryDrag(internalPayload);
    if (entries) {
      insertPathMentions(formatProjectEntryReferences(entries), { from, to });
    }
    return;
  }

  if (!onDropFiles) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  void onDropFiles(files)
    .then((paths) => insertPathMentions(paths, { from, to }))
    .catch((error: unknown) => {
      console.error("Failed to resolve dropped file paths", error);
    });
}

function handlePaste(event: ClipboardEvent) {
  if (disabled || !onPasteImage) return false;
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (!files.length) return false;
  event.preventDefault();
  void Promise.all(files.map((file) => onPasteImage(file)))
    .then((paths) => insertPathMentions(paths, undefined, "image"))
    .catch((error: unknown) => {
      console.error("Failed to paste clipboard image", error);
    });
  return true;
}

function captureContext(event: MouseEvent): void {
  if (!view) return;
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null) return;
  const selection = contextSelection(view.state, position);
  if (selection) view.dispatch({ selection });
  contextVersion += 1;
}

function runEditorCommand(command: (target: EditorView) => boolean): void {
  if (!view) return;
  command(view);
  view.focus();
  contextVersion += 1;
}

async function copyOrCut(cut: boolean): Promise<void> {
  if (!view || !onWriteClipboardText) return;
  const range = view.state.selection.main;
  if (range.empty) return;
  const document = view.state.doc.toString();
  const text = view.state.sliceDoc(range.from, range.to);
  try {
    await onWriteClipboardText(text);
    if (cut && !disabled && view.state.doc.toString() === document) {
      view.dispatch({ changes: { from: range.from, to: range.to } });
    }
  } catch {
    onClipboardError?.(cut ? "cut" : "copy");
  } finally {
    view.focus();
    contextVersion += 1;
  }
}

async function pasteText(): Promise<void> {
  if (!view || disabled || !onReadClipboardText) return;
  try {
    const text = await onReadClipboardText();
    insertAtRange(text);
  } catch {
    onClipboardError?.("paste");
    view.focus();
  } finally {
    contextVersion += 1;
  }
}

function selectAllText(): void {
  if (!view) return;
  view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
  view.focus();
  contextVersion += 1;
}

const menuItems = $derived.by<ContextMenuItem[]>(() => {
  void contextVersion;
  if (!view) return [];
  const hasSelection = !view.state.selection.main.empty;
  return [
    {
      label: "Undo",
      icon: Undo2,
      shortcut: viewerShortcut("z"),
      disabled: disabled || undoDepth(view.state) === 0,
      onSelect: () => runEditorCommand(undo),
    },
    {
      label: "Redo",
      icon: Redo2,
      shortcut: viewerShortcut("z", { shift: true }),
      disabled: disabled || redoDepth(view.state) === 0,
      onSelect: () => runEditorCommand(redo),
    },
    { type: "separator" },
    {
      label: "Cut",
      icon: Scissors,
      shortcut: viewerShortcut("x"),
      disabled: disabled || !hasSelection || !onWriteClipboardText,
      onSelect: () => void copyOrCut(true),
    },
    {
      label: "Copy",
      icon: Copy,
      shortcut: viewerShortcut("c"),
      disabled: !hasSelection || !onWriteClipboardText,
      onSelect: () => void copyOrCut(false),
    },
    {
      label: "Paste",
      icon: Clipboard,
      shortcut: viewerShortcut("v"),
      disabled: disabled || !onReadClipboardText,
      onSelect: () => void pasteText(),
    },
    { type: "separator" },
    {
      label: "Select all",
      icon: TextSelect,
      shortcut: viewerShortcut("a"),
      onSelect: selectAllText,
    },
  ];
});

onMount(() => {
  editorValue = value;
  shellMode = isInlineCommandPrompt(value);
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: value,
      extensions: [
        history(),
        markdown(),
        placeholderCompartment.of(placeholderExtension(placeholder)),
        editableCompartment.of(editableExtensions(disabled)),
        completionCompartment.of(
          composerCompletionExtensions(completionOptions),
        ),
        composerMentionChips(),
        composerDictationPlaceholder(),
        executableCommandBlockHighlighter,
        quoteBlockHighlighter,
        Prec.highest(
          keymap.of([
            { key: "Enter", run: submitOnEnter },
            { key: "Escape", run: cancelDictationOnEscape },
            { key: "Mod-Enter", run: submit },
            { key: "Ctrl-Enter", run: submit },
            indentWithTab,
          ]),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.domEventHandlers({ paste: handlePaste }),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged || update.selectionSet) contextVersion += 1;
          if (
            update.selectionSet ||
            (update.focusChanged && update.view.hasFocus)
          )
            caretPlaced = true;
          if (!update.docChanged) return;
          editorValue = update.state.doc.toString();
          shellMode = isInlineCommandPrompt(editorValue);
          onChange?.(editorValue);
        }),
        composerEditorTheme,
      ],
    }),
  });
  onReady?.(editorApi);
});

$effect(() => {
  if (!view) return;
  view.dispatch({
    effects: editableCompartment.reconfigure(editableExtensions(disabled)),
  });
  if (disabled) {
    fileDragDepth = 0;
    fileDragActive = false;
  }
});

$effect(() => {
  if (!view) return;
  void completionSlashItems;
  void completionReferenceSource;
  invalidateComposerCompletionRequests(completionOptions);
  closeCompletion(view);
  view.dispatch({
    effects: completionCompartment.reconfigure(
      composerCompletionExtensions(completionOptions),
    ),
  });
});

$effect(() => {
  if (!view) return;
  view.dispatch({
    effects: placeholderCompartment.reconfigure(
      placeholderExtension(placeholder),
    ),
  });
});

$effect(() => {
  if (!view || disabled || focusToken === lastFocusToken) return;
  lastFocusToken = focusToken;
  view.focus();
});

$effect(() => {
  if (!view || value === editorValue) return;
  const change = externalValueChange(view.state.doc.toString(), value);
  view.dispatch({
    changes: { from: change.from, to: change.to, insert: change.insert },
    selection: { anchor: change.caret },
    scrollIntoView: true,
  });
  editorValue = value;
  shellMode = isInlineCommandPrompt(value);
});

// Profile/running changes re-filter an open slash list without closing it.
$effect(() => {
  void slashContext?.profile;
  void slashContext?.running;
  if (view) refreshComposerReferenceCompletions(view);
});

$effect(() => {
  const source = completionReferenceSource;
  if (!source) return;
  let disposed = false;
  let queued = false;
  const unsubscribe = source.subscribe(() => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (disposed || !view || disabled || !popupModel) return;
      refreshComposerReferenceCompletions(view);
    });
  });
  return () => {
    disposed = true;
    unsubscribe();
  };
});

onDestroy(() => {
  invalidateComposerCompletionRequests(completionOptions);
  view?.destroy();
});
</script>

<div
  bind:this={root}
  class="composer-editor relative"
  data-prompt-composer-editor
  class:disabled
  class:shell-mode={shellMode}
  role="group"
  aria-label={ariaLabel}
  ondragentercapture={handleFileDragEnter}
  ondragovercapture={handleFileDragOver}
  ondragleavecapture={handleFileDragLeave}
  ondropcapture={handleFileDrop}
>
  <ContextMenuList items={menuItems} triggerClass="block min-w-0">
    <div
      bind:this={host}
      role="presentation"
      oncontextmenu={captureContext}
    ></div>
  </ContextMenuList>
  {#if popupModel && !disabled}
    <ComposerCompletionPopup
      model={popupModel}
      anchor={root}
      onpick={pickSuggestion}
      onhover={(id) => view && composerCompletionController(view)?.select(id)}
      ontoggle={(id) => {
        if (!view) return;
        composerCompletionController(view)?.toggle(id);
        view.focus();
      }}
      onscope={(scope) => {
        if (!view) return;
        composerCompletionController(view)?.setScope(scope);
        view.focus();
      }}
      onclearscope={() => {
        if (!view) return;
        composerCompletionController(view)?.clearScope();
        view.focus();
      }}
      onfooteraction={() =>
        view && composerCompletionController(view)?.runFooterAction()}
    />
  {/if}
  {#if fileDragActive}
    <div
      class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-md border border-primary bg-background/95 px-4 text-sm font-medium text-foreground shadow-sm"
      aria-hidden="true"
    >
      <FileIcon class="size-4 text-primary" />
      <span>Drop files or folders to add their paths</span>
    </div>
  {/if}
</div>

<style>
.composer-editor {
  overflow: visible;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--background);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease,
    opacity 160ms ease;
}

.composer-editor:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px color-mix(in oklab, var(--ring) 35%, transparent);
}

.composer-editor.disabled {
  opacity: 0.58;
}

.composer-editor.shell-mode :global(.cm-content) {
  font-family: var(--font-mono);
}

/* Phone: composer text must be >= 16px so iOS does not zoom on focus.
     Targets the CodeMirror-rendered content (escape hatch: rendered HTML). */
@media (max-width: 639px) {
  .composer-editor {
    /* One comfortable line; the editor grows as the prompt does. */
    --composer-editor-min-height: 2.75rem;
  }

  .composer-editor :global(.cm-editor .cm-content) {
    font-size: 1rem;
  }
}
</style>
