<script lang="ts">
import type { Snippet } from "svelte";
import ImageOff from "@lucide/svelte/icons/image-off";
import {
  writeClipboardImage,
  writeClipboardText,
} from "@nervekit/ui-kit/browser/clipboard";
import { downloadUrl } from "@nervekit/ui-kit/browser/download";
import ZoomableMedia from "./ZoomableMedia.svelte";

type Props = {
  src: string;
  alt: string;
  /** Used for downloads and the copy format (SVG copies as markup). */
  fileName: string;
  mimeType?: string;
  class?: string;
  /** Enables copying and reports the clipboard result. */
  onCopy?: (ok: boolean) => void;
  onOpenStandalone?: () => void;
  toolbarStart?: Snippet;
};

let {
  src,
  alt,
  fileName,
  mimeType,
  class: className = "",
  onCopy,
  onOpenStandalone,
  toolbarStart,
}: Props = $props();

// SVGs without width/height report no intrinsic size; browsers lay them
// out at 300×150, so use that as the natural size too.
const FALLBACK_SIZE = { width: 300, height: 150 };

let width = $state(0);
let height = $state(0);
let failed = $state(false);

const isSvg = $derived(
  mimeType === "image/svg+xml" || /\.svg$/i.test(fileName),
);
const info = $derived(width > 0 && !isSvg ? `${width} × ${height}` : undefined);

$effect(() => {
  void src;
  width = 0;
  height = 0;
  failed = false;
});

function handleLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  width = image.naturalWidth || FALLBACK_SIZE.width;
  height = image.naturalHeight || FALLBACK_SIZE.height;
}

async function copy() {
  try {
    const response = await fetch(src);
    if (isSvg) await writeClipboardText(await response.text());
    else await writeClipboardImage(await response.blob());
    onCopy?.(true);
  } catch {
    onCopy?.(false);
  }
}
</script>

<ZoomableMedia
  class={className}
  ariaLabel={alt}
  contentWidth={width}
  contentHeight={height}
  ready={!failed}
  maxFitScale={1}
  defaultWheelZoomEnabled
  transparencyToggle
  {info}
  copyLabel={isSvg ? "Copy SVG markup" : "Copy image"}
  onCopy={onCopy ? () => void copy() : undefined}
  onDownload={() => downloadUrl(src, fileName)}
  {onOpenStandalone}
  {toolbarStart}
>
  <img
    class="block max-w-none select-none"
    style:width={width ? `${width}px` : undefined}
    style:height={height ? `${height}px` : undefined}
    {src}
    {alt}
    draggable="false"
    onload={handleLoad}
    onerror={() => (failed = true)}
  />
  {#snippet overlay()}
    {#if failed}
      <div
        class="absolute inset-0 grid place-items-center content-center gap-1.5 text-center text-muted-foreground"
      >
        <ImageOff class="size-7" strokeWidth={1.7} />
        <strong class="font-medium text-foreground"
          >Image could not be shown</strong
        >
      </div>
    {/if}
  {/snippet}
</ZoomableMedia>
