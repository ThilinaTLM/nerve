<script lang="ts">
import type { Snippet } from "svelte";
import ContextMenu, {
  type ContextMenuItem,
} from "@nervekit/ui-kit/components/composites/context-menu-list";
import type { TranscriptMenuTarget } from "../conversations/conversation-view-contracts.js";
import { selectedTextForTranscriptRow } from "./transcript-context-selection.js";

type Props = {
  children: Snippet;
  target: TranscriptMenuTarget;
  menu: (
    target: TranscriptMenuTarget,
    selectedText?: string,
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
let selectedText = $state<string>();
const items = $derived(menu(target, selectedText));

function captureSelection(event: MouseEvent) {
  selectedText = selectedTextForTranscriptRow(
    window.getSelection(),
    event.currentTarget as Node,
  );
}
</script>

<div class="contents" role="presentation" oncontextmenu={captureSelection}>
  <ContextMenu {items} {triggerClass} {disabled}>
    {@render children()}
  </ContextMenu>
</div>
