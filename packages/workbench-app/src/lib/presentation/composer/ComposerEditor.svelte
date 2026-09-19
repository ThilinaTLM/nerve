<script lang="ts">
import { onDestroy, onMount } from "svelte";
import FileIcon from "@lucide/svelte/icons/file";
import Clipboard from "@lucide/svelte/icons/clipboard";
import Copy from "@lucide/svelte/icons/copy";
import Redo2 from "@lucide/svelte/icons/redo-2";
import Scissors from "@lucide/svelte/icons/scissors";
import TextSelect from "@lucide/svelte/icons/text-select";
import Undo2 from "@lucide/svelte/icons/undo-2";
import {
  acceptCompletion,
  closeCompletion,
  completionStatus,
} from "@codemirror/autocomplete";
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
import type { CompletionItem } from "@nervekit/contracts/completions";
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
import { executableCommandBlockHighlighter } from "./composer-command-blocks";
import {
  bestFileCompletionSelector,
  composerCompletionExtensions,
  type ComposerCompletionOptions,
} from "./composer-editor-completions";
import { composerEditorTheme } from "./composer-editor-theme";
type Props = {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  focusToken?: number;
  slashCompletions?: readonly CompletionItem[];
  fileCompletions?: (query: string) => Promise<CompletionItem[]>;
  referenceCompletions?: (
    kind: "task" | "pull_request",
    query: string,
  ) => Promise<CompletionItem[]>;
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
  fileCompletions,
  referenceCompletions,
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
const editableCompartment = new Compartment();
const completionCompartment = new Compartment();
const placeholderCompartment = new Compartment();

const completionOptions: ComposerCompletionOptions = {
  slashCompletions: () => slashCompletions,
  fileCompletions: () => fileCompletions,
  referenceCompletions: () => referenceCompletions,
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

function submitOnEnter(target: EditorView) {
  // Let the autocomplete keymap handle Enter when a completion popup is open.
  if (completionStatus(target.state) === "active") return false;
  return submit();
}

function acceptCompletionOnTab(target: EditorView): boolean {
  if (completionStatus(target.state) !== "active") return false;
  return acceptCompletion(target);
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

function insertDroppedPaths(
  paths: readonly string[],
  selection: { from: number; to: number },
): void {
  if (!view || paths.length === 0) return;
  const doc = view.state.doc;
  const from = Math.min(selection.from, doc.length);
  const to = Math.min(selection.to, doc.length);
  const before = from > 0 ? doc.sliceString(from - 1, from) : "";
  const after = to < doc.length ? doc.sliceString(to, to + 1) : "";
  const leadingSpace = before && !/\s/.test(before) ? " " : "";
  const trailingSpace = after && !/\s/.test(after) ? " " : "";
  insertAtRange(`${leadingSpace}${paths.join(" ")}${trailingSpace}`, from, to);
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
      insertDroppedPaths(formatProjectEntryReferences(entries), { from, to });
    }
    return;
  }

  if (!onDropFiles) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0) return;
  void onDropFiles(files)
    .then((paths) => insertDroppedPaths(paths, { from, to }))
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
    .then((paths) => insertAtRange(paths.join("\n")))
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
        executableCommandBlockHighlighter,
        bestFileCompletionSelector,
        Prec.highest(
          keymap.of([
            { key: "Enter", run: submitOnEnter },
            { key: "Tab", run: acceptCompletionOnTab },
            { key: "Escape", run: closeCompletion },
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
          if (!update.docChanged) return;
          editorValue = update.state.doc.toString();
          onChange?.(editorValue);
        }),
        composerEditorTheme,
      ],
    }),
  });
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
  void slashCompletions;
  void fileCompletions;
  void referenceCompletions;
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
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
  });
  editorValue = value;
});

onDestroy(() => view?.destroy());
</script>

<div
  class="composer-editor relative"
  data-prompt-composer-editor
  class:disabled
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

/* Phone: composer text must be >= 16px so iOS does not zoom on focus.
     Targets the CodeMirror-rendered content (escape hatch: rendered HTML). */
@media (max-width: 639px) {
  .composer-editor :global(.cm-editor .cm-content) {
    font-size: 1rem;
  }
}
</style>
