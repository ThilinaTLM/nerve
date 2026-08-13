<script lang="ts">
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { onDestroy } from "svelte";
import {
  loadCodeLanguage,
  localLineNumber,
  readOnlyCodeExtensions,
  shouldShowCodeMinimap,
} from "./code-mirror-config";

type Props = {
  text: string;
  language?: string;
  lineStart?: number;
  targetLine?: number;
  wrap?: boolean;
  ariaLabel?: string;
  class?: string;
};

let {
  text,
  language,
  lineStart = 1,
  targetLine,
  wrap = false,
  ariaLabel = "Code viewer",
  class: className = "",
}: Props = $props();

let host = $state<HTMLElement | null>(null);
let view: EditorView | undefined;
let generation = 0;

function targetLineExtension(
  state: EditorState,
  externalLine: number | undefined,
  firstLine: number,
): Extension {
  const local = localLineNumber(externalLine, firstLine, state.doc.lines);
  if (!local) return [];
  return EditorView.decorations.of(
    Decoration.set([
      Decoration.line({ class: "cm-target-line" }).range(
        state.doc.line(local).from,
      ),
    ]),
  );
}

async function renderEditor(): Promise<void> {
  if (!host) return;
  const currentGeneration = ++generation;
  const languageExtension = await loadCodeLanguage(language);
  if (!host || currentGeneration !== generation) return;

  const baseExtensions: Extension[] = [
    ...readOnlyCodeExtensions({
      lineStart,
      ariaLabel,
      minimap: shouldShowCodeMinimap(text, wrap),
    }),
    languageExtension,
    wrap ? EditorView.lineWrapping : [],
  ];
  let state = EditorState.create({ doc: text, extensions: baseExtensions });
  state = EditorState.create({
    doc: text,
    extensions: [
      ...baseExtensions,
      targetLineExtension(state, targetLine, lineStart),
    ],
  });

  view?.destroy();
  view = new EditorView({ state, parent: host });

  const localTarget = localLineNumber(targetLine, lineStart, state.doc.lines);
  if (localTarget) {
    view.dispatch({
      effects: EditorView.scrollIntoView(state.doc.line(localTarget).from, {
        y: "center",
      }),
    });
  }
}

$effect(() => {
  void text;
  void language;
  void lineStart;
  void targetLine;
  void wrap;
  void ariaLabel;
  if (host) void renderEditor();
});

onDestroy(() => {
  generation += 1;
  view?.destroy();
});
</script>

<div
  bind:this={host}
  class={`h-full min-h-0 min-w-0 overflow-hidden bg-background ${className}`}
></div>
