<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { markdown } from "@codemirror/lang-markdown";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { Compartment, EditorState, Prec } from "@codemirror/state";
  import { EditorView, keymap, placeholder as placeholderExtension, type ViewUpdate } from "@codemirror/view";

  type Props = {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    onChange?: (value: string) => void;
    onSubmit?: () => void;
  };

  let {
    value,
    placeholder = "Ask the local Nerve agent…",
    disabled = false,
    onChange,
    onSubmit,
  }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let editorValue = $state(value);
  const editableCompartment = new Compartment();

  function editableExtensions(isDisabled: boolean) {
    return [EditorState.readOnly.of(isDisabled), EditorView.editable.of(!isDisabled)];
  }

  function submit() {
    if (disabled) return false;
    onSubmit?.();
    return true;
  }

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown(),
          placeholderExtension(placeholder),
          editableCompartment.of(editableExtensions(disabled)),
          Prec.highest(
            keymap.of([
              { key: "Mod-Enter", run: submit },
              { key: "Ctrl-Enter", run: submit },
              indentWithTab,
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (!update.docChanged) return;
            editorValue = update.state.doc.toString();
            onChange?.(editorValue);
          }),
          EditorView.theme({
            "&": {
              background: "#020617",
              color: "#eef2ff",
              minHeight: "156px",
            },
            ".cm-content": {
              caretColor: "#7dd3fc",
              fontFamily:
                'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
              fontSize: "0.95rem",
              lineHeight: "1.55",
              padding: "14px 16px",
            },
            ".cm-line": {
              padding: "0 2px",
            },
            ".cm-cursor": {
              borderLeftColor: "#7dd3fc",
            },
            ".cm-placeholder": {
              color: "#64748b",
            },
            ".cm-scroller": {
              minHeight: "156px",
              overflow: "auto",
            },
            "&.cm-focused": {
              outline: "none",
            },
            "&.cm-focused .cm-cursor": {
              borderLeftColor: "#7dd3fc",
            },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
              backgroundColor: "rgba(125, 211, 252, 0.22)",
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
    if (!view || value === editorValue) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
    editorValue = value;
  });

  onDestroy(() => view?.destroy());
</script>

<div class="composer-editor" class:disabled bind:this={host}></div>
<p class="composer-hint"><kbd>⌘</kbd><kbd>Enter</kbd> sends · Markdown supported</p>

<style>
  .composer-editor {
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: #020617;
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 4%);
    transition:
      border-color 160ms ease,
      box-shadow 160ms ease,
      opacity 160ms ease;
  }

  .composer-editor:focus-within {
    border-color: rgb(125 211 252 / 68%);
    box-shadow:
      0 0 0 3px rgb(125 211 252 / 10%),
      inset 0 1px 0 rgb(255 255 255 / 5%);
  }

  .composer-editor.disabled {
    opacity: 0.58;
  }

  .composer-hint {
    margin: -6px 0 0;
    color: var(--color-muted);
    font-size: 0.78rem;
  }

  kbd {
    display: inline-grid;
    min-width: 1.35rem;
    place-items: center;
    margin: 0 2px;
    border: 1px solid var(--color-border);
    border-radius: 0.35rem;
    background: rgb(2 6 23 / 90%);
    color: #dbeafe;
    font-size: 0.72rem;
    line-height: 1.35;
  }
</style>
