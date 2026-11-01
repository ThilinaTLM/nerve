<script lang="ts">
import type {
  ToolCallDisplayRecord,
  ToolView,
} from "../views/tool-result-view";
import { asRecord } from "../views/tool-view-helpers";
import ImageFrame from "./ImageFrame.svelte";
import ToolSections from "./ToolSections.svelte";

type Props = {
  toolCall: ToolCallDisplayRecord;
  view: Extract<ToolView, { kind: "generate_image" }>;
  expanded?: boolean;
  onOpenFile?: (path: string, line?: number) => void;
};

let { toolCall, view, onOpenFile }: Props = $props();

/** `1024x576` argument → ratio; the frame is reserved before the result. */
const argRatio = $derived.by(() => {
  const payloads = toolCall as { argsPreview?: unknown; args?: unknown };
  const args = asRecord(payloads.argsPreview ?? payloads.args);
  const match = /^(\d+)\s*[x×]\s*(\d+)$/.exec(String(args.size ?? ""));
  return match ? Number(match[1]) / Number(match[2]) : undefined;
});

function ratioFor(index: number): number {
  const image = view.images?.[index];
  if (image?.width && image.height) return image.width / image.height;
  return argRatio ?? 1;
}
</script>

<ToolSections>
  {#each view.paths as path, index (index)}
    <ImageFrame
      ratio={ratioFor(index)}
      {path}
      cwd={toolCall.cwd}
      caption={path}
      captionLabel="Open generated image in a file tab"
      onOpen={onOpenFile ? () => onOpenFile(path) : undefined}
    />
  {:else}
    {#if toolCall.status === "completed"}
      <p class="m-0 px-3 py-2 text-ui text-muted-foreground">
        No image file returned.
      </p>
    {/if}
  {/each}
</ToolSections>
