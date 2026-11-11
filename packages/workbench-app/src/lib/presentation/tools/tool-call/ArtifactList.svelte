<script lang="ts">
import type { CodeModeArtifact } from "@nervekit/contracts/tools";
import ImageFrame from "./ImageFrame.svelte";

type Props = {
  artifacts: readonly CodeModeArtifact[];
  onOpenFile?: (path: string, line?: number) => void;
};
let { artifacts, onOpenFile }: Props = $props();

const previewable = (mediaType: string) =>
  mediaType === "image/png" || mediaType === "image/jpeg";
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<ul class="m-0 list-none p-0" aria-label="Artifacts">
  {#each artifacts as artifact (artifact.handle)}
    <li>
      {#if previewable(artifact.mediaType)}
        <ImageFrame
          ratio={artifact.width && artifact.height
            ? artifact.width / artifact.height
            : 4 / 3}
          path={artifact.path}
          alt={artifact.handle}
          caption={`${artifact.handle} · ${formatBytes(artifact.bytes)}`}
          captionLabel="Open artifact in a file tab"
          lightBackdrop
          onOpen={onOpenFile ? () => onOpenFile(artifact.path) : undefined}
        />
      {:else}
        <button
          type="button"
          class="flex w-full min-w-0 cursor-pointer items-baseline gap-2 border-0 bg-transparent px-2.5 py-0.5 text-left text-ui text-muted-foreground hover:text-foreground"
          aria-label="Open artifact in a file tab"
          disabled={!onOpenFile}
          onclick={() => onOpenFile?.(artifact.path)}
        >
          <span class="min-w-0 flex-1 truncate font-mono"
            >{artifact.handle}</span
          >
          <span class="flex-none text-caption tabular-nums"
            >{formatBytes(artifact.bytes)}</span
          >
        </button>
      {/if}
    </li>
  {/each}
</ul>
