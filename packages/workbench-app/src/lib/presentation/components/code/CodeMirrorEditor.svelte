<script lang="ts">
import { json } from "@codemirror/lang-json";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { onDestroy, onMount } from "svelte";
import { editableCodeExtensions } from "./code-mirror-config";

type Props = {
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  class?: string;
};

let {
  value,
  onChange,
  disabled = false,
  ariaLabel = "Code editor",
  class: className = "",
}: Props = $props();

let host: HTMLElement;
let view: EditorView | undefined;
const editableCompartment = new Compartment();

function editableExtensions(isDisabled: boolean) {
  return [
    EditorState.readOnly.of(isDisabled),
    EditorView.editable.of(!isDisabled),
  ];
}

onMount(() => {
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: value,
      extensions: [
        ...editableCodeExtensions(ariaLabel),
        json(),
        EditorView.lineWrapping,
        editableCompartment.of(editableExtensions(disabled)),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (!update.docChanged) return;
          const next = update.state.doc.toString();
          if (next !== value) onChange?.(next);
        }),
      ],
    }),
  });
});

$effect(() => {
  if (!view) return;
  const current = view.state.doc.toString();
  if (current !== value) {
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }
});

$effect(() => {
  if (!view) return;
  view.dispatch({
    effects: editableCompartment.reconfigure(editableExtensions(disabled)),
  });
});

onDestroy(() => view?.destroy());
</script>

<div
  bind:this={host}
  class={`h-full min-h-0 min-w-0 overflow-hidden bg-background ${className}`}
></div>
