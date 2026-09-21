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

{#if view.images.length > 0}
  <div class="grid gap-2 sm:grid-cols-2" aria-label="Generated image results">
    {#each view.images as image, index (`${image.path ?? "image"}-${index}`)}
      <figure class="m-0 min-w-0 overflow-hidden rounded-sm border bg-well">
        <img
          class="block h-auto max-h-[32rem] w-full object-contain"
          src={image.dataUrl}
          alt={view.prompt
            ? `Generated image: ${view.prompt}`
            : "Generated image"}
        />
        {#if image.path}
          <figcaption class="flex items-center gap-2 border-t px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              class="min-w-0 max-w-full font-mono text-muted-foreground"
              onclick={() => onOpenFile?.(image.path!)}
              title={image.path}
            >
              <span class="truncate">{image.path}</span>
            </Button>
          </figcaption>
        {/if}
      </figure>
    {/each}
  </div>
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No image returned.</p>
{/if}
