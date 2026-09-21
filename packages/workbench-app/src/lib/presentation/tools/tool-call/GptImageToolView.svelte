<script lang="ts">
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import { formatBytes } from "../views/tool-presentation-helpers";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "gpt_image" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};

let { toolCall, view, onOpenFile }: Props = $props();

function imageMetadata(image: (typeof view.images)[number]): string {
  return [image.mimeType, formatBytes(image.byteSize)]
    .filter(Boolean)
    .join(" · ");
}
</script>

{#if view.images.length > 0}
  <div class="grid gap-2 sm:grid-cols-2" aria-label="Generated image results">
    {#each view.images as image, index (`${image.path ?? "image"}-${index}`)}
      <figure class="m-0 min-w-0 overflow-hidden rounded-sm border bg-well">
        {#if image.dataUrl}
          <img
            class="block h-auto max-h-[32rem] w-full object-contain"
            src={image.dataUrl}
            alt={view.prompt
              ? `Generated image: ${view.prompt}`
              : "Generated image"}
          />
        {:else}
          <div class="px-3 py-5 text-center text-xs text-muted-foreground">
            Image preview omitted from the conversation transcript.
          </div>
        {/if}
        <figcaption class="grid gap-1 border-t px-2 py-1.5">
          {#if image.path}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              class="min-w-0 max-w-full justify-start font-mono text-muted-foreground"
              onclick={() => onOpenFile?.(image.path!)}
              title={image.path}
            >
              <span class="truncate">{image.path}</span>
            </Button>
          {/if}
          {#if imageMetadata(image)}
            <span class="px-2 text-xs text-muted-foreground">
              {imageMetadata(image)}
            </span>
          {/if}
          {#if image.revisedPrompt}
            <p class="m-0 px-2 text-xs text-muted-foreground">
              Revised prompt: {image.revisedPrompt}
            </p>
          {/if}
        </figcaption>
      </figure>
    {/each}
  </div>
{:else if toolCall.status === "completed"}
  <p class="m-0 text-xs text-muted-foreground">No image returned.</p>
{/if}
