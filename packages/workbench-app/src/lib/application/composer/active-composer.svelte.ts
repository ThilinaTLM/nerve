import type { ComposerView } from "./composer-view.svelte";
let current = $state.raw<ComposerView>();
export const activeComposer = () => current;
export function activateComposer(view: ComposerView): () => void {
  current = view;
  return () => {
    if (current === view) current = undefined;
  };
}
