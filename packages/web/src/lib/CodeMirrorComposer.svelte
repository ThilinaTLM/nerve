<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { autocompletion, completionStatus, type Completion, type CompletionContext } from "@codemirror/autocomplete";
  import { markdown } from "@codemirror/lang-markdown";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { Compartment, EditorState, Prec } from "@codemirror/state";
  import { EditorView, keymap, placeholder as placeholderExtension, type ViewUpdate } from "@codemirror/view";
  import type { CompletionItem } from "./api";
  import { clientLog } from "$lib/core/logger/client-logger";

  type Props = {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    focusToken?: number;
    slashCompletions?: CompletionItem[];
    fileCompletions?: (query: string) => Promise<CompletionItem[]>;
    onChange?: (value: string) => void;
    onSubmit?: () => void;
    onPasteImage?: (file: File) => Promise<string>;
  };

  let {
    value,
    placeholder = "Ask the local Nerve agent",
    disabled = false,
    focusToken = 0,
    slashCompletions = [],
    fileCompletions,
    onChange,
    onSubmit,
    onPasteImage,
  }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let editorValue = $state("");
  let lastFocusToken = 0;
  const editableCompartment = new Compartment();
  const completionCompartment = new Compartment();
  const placeholderCompartment = new Compartment();

  function editableExtensions(isDisabled: boolean) {
    return [EditorState.readOnly.of(isDisabled), EditorView.editable.of(!isDisabled)];
  }

  function toCompletion(item: CompletionItem): Completion {
    return {
      label: item.label,
      detail: item.detail,
      info: item.info,
      type: item.kind === "directory" ? "folder" : item.kind === "file" ? "file" : "keyword",
      apply: item.apply ?? item.label,
    };
  }

  async function completionSource(context: CompletionContext) {
    const before = context.matchBefore(/(?:^|\s)([/@][^\s]*)/);
    if (!before && !context.explicit) return null;
    const rawToken = before?.text.trimStart() ?? "";
    const tokenStart = before ? before.to - rawToken.length : context.pos;

    if (rawToken.startsWith("/")) {
      const options = slashCompletions
        .filter((item) => item.label.startsWith(rawToken) || item.label.includes(rawToken.slice(1)))
        .map(toCompletion);
      return { from: tokenStart, options, validFor: /^\/[\w-]*$/ };
    }

    if (rawToken.startsWith("@")) {
      const query = rawToken.slice(1);
      const options = (await fileCompletions?.(query) ?? []).map(toCompletion);
      return { from: tokenStart, options };
    }

    if (context.explicit) {
      return { from: context.pos, options: slashCompletions.map(toCompletion) };
    }

    return null;
  }

  function completionExtensions() {
    return autocompletion({ override: [completionSource] });
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

  function insertAtSelection(text: string) {
    if (!view) return;
    const selection = view.state.selection.main;
    view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: text },
      selection: { anchor: selection.from + text.length },
      scrollIntoView: true,
    });
    view.focus();
  }

  function handlePaste(event: ClipboardEvent) {
    if (disabled || !onPasteImage) return false;
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!files.length) return false;
    event.preventDefault();
    void Promise.all(files.map((file) => onPasteImage(file)))
      .then((paths) => insertAtSelection(paths.join("\n")))
      .catch((error: unknown) => {
        clientLog("error", "composer", "Failed to paste clipboard image", {
          error,
        });
      });
    return true;
  }

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
          completionCompartment.of(completionExtensions()),
          Prec.highest(
            keymap.of([
              { key: "Enter", run: submitOnEnter },
              { key: "Mod-Enter", run: submit },
              { key: "Ctrl-Enter", run: submit },
              indentWithTab,
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({ paste: handlePaste }),
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (!update.docChanged) return;
            editorValue = update.state.doc.toString();
            onChange?.(editorValue);
          }),
          EditorView.theme({
            "&": {
              background: "transparent",
              color: "var(--foreground)",
              maxHeight: "min(40vh, 320px)",
            },
            ".cm-content": {
              caretColor: "var(--primary)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)",
              lineHeight: "1.5",
              padding: "18px 46px 14px 11px",
            },
            ".cm-line": {
              padding: "0 2px",
            },
            ".cm-cursor": {
              borderLeftColor: "var(--primary)",
            },
            ".cm-placeholder": {
              color: "color-mix(in oklab, var(--muted-foreground) 75%, transparent)",
            },
            ".cm-scroller": {
              minHeight: "92px",
              maxHeight: "min(40vh, 320px)",
              overflow: "auto",
            },
            ".cm-tooltip": {
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--accent)",
              color: "var(--foreground)",
              boxShadow: "var(--shadow-md)",
              overflow: "hidden",
            },
            ".cm-tooltip-autocomplete ul li[aria-selected]": {
              background: "var(--accent)",
              color: "var(--foreground)",
            },
            "&.cm-focused": {
              outline: "none",
            },
            "&.cm-focused .cm-cursor": {
              borderLeftColor: "var(--primary)",
            },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
              backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent)",
            },
          }),
        ],
      }),
    });
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.reconfigure(editableExtensions(disabled)),
    });
  });

  $effect(() => {
    if (!view) return;
    slashCompletions;
    fileCompletions;
    view.dispatch({
      effects: completionCompartment.reconfigure(completionExtensions()),
    });
  });

  $effect(() => {
    if (!view) return;
    view.dispatch({
      effects: placeholderCompartment.reconfigure(placeholderExtension(placeholder)),
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

<div class="composer-editor" class:disabled bind:this={host}></div>

<style>
  .composer-editor {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--input);
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

</style>
