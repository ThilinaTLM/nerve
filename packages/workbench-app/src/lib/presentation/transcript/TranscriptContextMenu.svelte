<script lang="ts">
import type { Snippet } from "svelte";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import type {
  TranscriptMenuTarget,
  TranscriptSelection,
} from "../conversations/conversation-view-contracts.js";
import { selectionToMarkdown } from "./selection-markdown.js";
import { selectedTextForTranscriptRow } from "./transcript-context-selection.js";

type Props = {
  children: Snippet;
  target: TranscriptMenuTarget;
  menu: (
    target: TranscriptMenuTarget,
    selection?: TranscriptSelection,
  ) => ContextMenuItem[];
  triggerClass?: string;
  disabled?: boolean;
};

let {
  children,
  target,
  menu,
  triggerClass,
  disabled = false,
}: Props = $props();
let selection = $state<TranscriptSelection>();
const items = $derived(menu(target, selection));

function captureSelection(event: MouseEvent) {
  const domSelection = window.getSelection();
  const text = selectedTextForTranscriptRow(
    domSelection,
    event.currentTarget as Node,
  );
  selection =
    text && domSelection
      ? { text, markdown: selectionToMarkdown(domSelection) || text }
      : undefined;
}
</script>

<div class="contents" role="presentation" oncontextmenu={captureSelection}>
  <ContextMenu {items} {triggerClass} {disabled}>
    {@render children()}
  </ContextMenu>
</div>
