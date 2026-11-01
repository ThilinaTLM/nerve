<script lang="ts">
// Image section: the frame is reserved at its final aspect ratio before the
// picture exists (skeleton), then the picture fades in at the same position.
// The caption is the file path.
import { fade } from "svelte/transition";
import ImageIcon from "@lucide/svelte/icons/image";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";
import { getConversationUiCapabilities } from "../../context.svelte";

type Props = {
  /** `width / height`; the frame keeps this ratio in every state. */
  ratio: number;
  /** Workspace file to display; resolved once through `imageSource`. */
  path?: string;
  /** Directory that relative `path`s resolve against. */
  cwd?: string;
  /** False while the image is still being produced. */
  ready?: boolean;
  alt?: string;
  caption?: string;
  captionLabel?: string;
  onOpen?: () => void;
  /** Render nothing unless the image resolves (no icon placeholder). */
  optional?: boolean;
};
let {
  ratio,
  path,
  cwd,
  ready = true,
  alt = "",
  caption,
  captionLabel,
  onOpen,
  optional = false,
}: Props = $props();

const imageSource = getConversationUiCapabilities().imageSource;
/** Undefined: loading or unavailable. `loading` keeps the skeleton. */
let src = $state<string | undefined>(undefined);
let loading = $state(true);
const waiting = $derived(Boolean(imageSource && path) && loading);

function absolute(target: string): string {
  if (/^([a-zA-Z]:)?[\\/]/.test(target) || !cwd) return target;
  return `${cwd.replace(/[\\/]+$/, "")}/${target.replace(/^\.\//, "")}`;
}

// Fetch once per mounted frame; no polling.
$effect(() => {
  if (!imageSource || !path) return;
  let live = true;
  void imageSource(absolute(path)).then((value) => {
    if (!live) return;
    src = value;
    loading = false;
  });
  return () => {
    live = false;
  };
});
</script>

{#if !optional || waiting || src}
  <div class="grid gap-1.5 p-2">
    <div
      class="grid w-full max-w-sm overflow-hidden rounded-sm"
      style:aspect-ratio={ratio}
    >
      {#if src}
        <img
          class="col-start-1 row-start-1 size-full object-contain"
          {src}
          {alt}
          in:fade={{ duration: 450 }}
        />
      {:else if ready && !waiting}
        <div
          class="col-start-1 row-start-1 flex items-center justify-center bg-muted text-muted-foreground"
          in:fade={{ duration: 450 }}
        >
          <ImageIcon class="size-5" strokeWidth={1.5} aria-hidden="true" />
        </div>
      {:else}
        <Skeleton
          class="col-start-1 row-start-1 size-full rounded-sm bg-hover"
        />
      {/if}
    </div>
    {#if caption}
      {#if onOpen}
        <button
          type="button"
          class="min-w-0 cursor-pointer justify-self-start truncate border-0 bg-transparent p-0 text-left font-mono text-ui text-muted-foreground hover:text-foreground"
          aria-label={captionLabel}
          title={caption}
          onclick={onOpen}>{caption}</button
        >
      {:else}
        <span class="min-w-0 truncate font-mono text-ui text-muted-foreground"
          >{caption}</span
        >
      {/if}
    {/if}
  </div>
{/if}
