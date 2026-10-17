<script lang="ts">
import type { ToolCallDisplayRecord } from "../views/tool-result-view";
import { extname } from "../views/lang";
import type { ToolView } from "../views/tool-result-view";
import ToolOutputBlock from "./ToolOutputBlock.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "read" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};
let { toolCall, view, expanded = false, onOpenFile }: Props = $props();

const language = $derived(extname(view.relPath));
const hasContent = $derived(
  view.content !== undefined && view.content.length > 0,
);
</script>

{#if view.image || hasContent || toolCall.status === "completed"}
  <ToolSections>
    {#if view.image}
      <div class="p-2">
        <button
          class="cursor-pointer border-0 bg-transparent p-0"
          type="button"
          onclick={() => view.path && onOpenFile?.(view.path)}
          title="Open image pane"
        >
          <img
            class="max-h-60 max-w-80 rounded-sm border object-contain"
            src={view.image.dataUrl}
            alt={view.relPath ?? "image"}
          />
        </button>
      </div>
    {:else if hasContent}
      <div class="px-2.5 py-2">
        <ToolOutputBlock text={view.content ?? ""} {language} {expanded} />
      </div>
    {:else}
      <div class="px-2.5 py-2 text-xs text-muted-foreground">Empty file.</div>
    {/if}
  </ToolSections>
{/if}
