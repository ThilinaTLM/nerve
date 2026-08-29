<script lang="ts">
import type {
  AgentPreviewSnapshot,
  AgentProjectionSnapshot,
} from "@nervekit/contracts";
import ResultCodeBlock from "./ResultCodeBlock.svelte";

type Props = {
  preview?: AgentPreviewSnapshot;
  projection?: AgentProjectionSnapshot;
  result?: unknown;
  open?: boolean;
};
let { preview, projection, result, open = false }: Props = $props();

function imageData(index: number, mimeType: string): string | undefined {
  if (!result || typeof result !== "object" || Array.isArray(result)) return;
  const blocks = (result as Record<string, unknown>).contentBlocks;
  if (!Array.isArray(blocks)) return;
  const block = blocks[index];
  if (!block || typeof block !== "object" || Array.isArray(block)) return;
  const record = block as Record<string, unknown>;
  if (record.type !== "image" || record.mimeType !== mimeType) return;
  return typeof record.data === "string" ? record.data : undefined;
}

function supportedImageMime(mimeType: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
    mimeType,
  );
}
</script>

<details class="rounded-sm border bg-muted/20" {open}>
  <summary
    class="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground"
  >
    Agent preview
  </summary>
  <div class="grid gap-2 border-t p-2">
    {#if preview}
      {#if preview.blocks.length === 0}
        <p class="m-0 text-sm text-muted-foreground">
          The agent received an empty result.
        </p>
      {:else}
        {#each preview.blocks as block, index (`${block.type}:${index}`)}
          {#if block.type === "text"}
            <ResultCodeBlock code={block.text} maxHeight="22rem" trim={false} />
          {:else}
            {@const data = imageData(
              block.resultContentBlockIndex,
              block.mimeType,
            )}
            <div class="grid gap-2 rounded-sm border bg-background p-2">
              <p class="m-0 text-xs text-muted-foreground">
                Image supplied to the agent · {block.mimeType} · {block.byteLength.toLocaleString()}
                bytes
              </p>
              {#if data && supportedImageMime(block.mimeType)}
                <img
                  class="max-h-80 max-w-full rounded-sm object-contain"
                  src={`data:${block.mimeType};base64,${data}`}
                  alt="Image supplied to the agent"
                />
              {/if}
            </div>
          {/if}
        {/each}
      {/if}
    {:else}
      <p class="m-0 text-sm text-muted-foreground">
        No retained agent preview is available for this tool call.
      </p>
    {/if}
    {#if projection}
      <div class="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        <span class="rounded-sm border px-1.5 py-0.5">{projection.profile}</span
        >
        <span class="rounded-sm border px-1.5 py-0.5"
          >{projection.strategy}</span
        >
        <span class="rounded-sm border px-1.5 py-0.5">
          {projection.displayedTextLines.toLocaleString()} of {projection.originalTextLines.toLocaleString()}
          lines
        </span>
        {#if projection.recovery !== "none"}
          <span class="rounded-sm border px-1.5 py-0.5"
            >Recovery: {projection.recovery.replace("_", " ")}</span
          >
        {/if}
      </div>
    {/if}
  </div>
</details>
