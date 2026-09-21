<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "gpt_image" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};

let { toolCall, view, onOpenFile }: Props = $props();
</script>

{#if view.paths.length > 0}
  <div
    class="grid justify-items-start gap-1"
    aria-label="Generated image files"
  >
    {#each view.paths as path (path)}
      <Button
        type="button"
        variant="link"
        size="xs"
        class="h-auto max-w-full justify-start px-0 font-mono"
        onclick={() => onOpenFile?.(path)}
        title={path}
      >
        <span class="truncate">{path}</span>
      </Button>
    {/each}
  </div>
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No image file returned.</p>
{/if}
