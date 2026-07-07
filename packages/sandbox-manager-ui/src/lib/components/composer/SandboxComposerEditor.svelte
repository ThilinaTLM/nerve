<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { markdown } from "@codemirror/lang-markdown";
  import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
  } from "@codemirror/commands";
  import { Compartment, EditorState, Prec } from "@codemirror/state";
  import {
    Decoration,
    type DecorationSet,
    EditorView,
    keymap,
    placeholder as placeholderExtension,
    ViewPlugin,
    type ViewUpdate,
  } from "@codemirror/view";
  import { findExecutableCommandBlocks } from "@nervekit/shared";

  type Props = {
    value: string;
    placeholder?: string;
    disabled?: boolean;
    focusToken?: number;
    onChange?: (value: string) => void;
    onSubmit?: () => void;
  };

  let {
    value,
    placeholder = "Ask the sandbox agent",
    disabled = false,
    focusToken = 0,
    onChange,
    onSubmit,
  }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let editorValue = $state("");
  let lastFocusToken = 0;
  const editableCompartment = new Compartment();
  const placeholderCompartment = new Compartment();

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

  function executableCommandBlockDecorations(state: EditorState): DecorationSet {
    const ranges = [];
    const blockLine = Decoration.line({
      class: "cm-executable-command-block-line",
    });
    const commandMark = Decoration.mark({
      class: "cm-executable-command-block-command",
    });
    for (const block of findExecutableCommandBlocks(state.doc.toString())) {
      let pos = block.start;
      while (pos < block.end) {
        const line = state.doc.lineAt(pos);
        ranges.push(blockLine.range(line.from));
        if (line.to >= block.end) break;
        pos = line.to + 1;
      }
      if (block.commandEnd > block.commandStart) {
        ranges.push(commandMark.range(block.commandStart, block.commandEnd));
      }
    }
    return Decoration.set(
      ranges.sort((a, b) => a.from - b.from || a.to - b.to),
      true,
    );
  }

  const executableCommandBlockHighlighter = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = executableCommandBlockDecorations(view.state);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.decorations = executableCommandBlockDecorations(update.state);
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
    },
  );

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
          executableCommandBlockHighlighter,
          Prec.highest(
            keymap.of([
              { key: "Enter", run: submit },
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
              color:
                "color-mix(in oklab, var(--muted-foreground) 75%, transparent)",
            },
            ".cm-executable-command-block-line": {
              backgroundColor: "color-mix(in oklab, var(--info) 9%, transparent)",
            },
            ".cm-executable-command-block-command": {
              backgroundColor:
                "color-mix(in oklab, var(--info) 16%, transparent)",
              color: "var(--foreground)",
              borderRadius: "var(--radius-sm)",
            },
            ".cm-scroller": {
              minHeight: "92px",
              maxHeight: "min(40vh, 320px)",
              overflow: "auto",
            },
            "&.cm-focused": {
              outline: "none",
            },
            "&.cm-focused .cm-cursor": {
              borderLeftColor: "var(--primary)",
            },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
              {
                backgroundColor:
                  "color-mix(in oklab, var(--primary) 22%, transparent)",
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

  /* Phone: composer text must be >= 16px so iOS does not zoom on focus.
     Targets the CodeMirror-rendered content (escape hatch: rendered HTML). */
  @media (max-width: 639px) {
    .composer-editor :global(.cm-editor .cm-content) {
      font-size: 1rem;
    }
  }
</style>
