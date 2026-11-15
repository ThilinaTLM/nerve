<!--
  An extension's identity mark. Lucide names render as monochrome glyphs that
  follow the text colour; the extension's own SVG renders as an <img> (never
  inlined: a third-party file cannot run scripts or read the page) and keeps
  its brand colours. Off: a lucide glyph turns muted, a brand mark desaturates.
  `tile` is the bordered tile of list rows; `inline` sits in a title.
-->
<script lang="ts">
import Blocks from "@lucide/svelte/icons/blocks";
import Globe from "@lucide/svelte/icons/globe";
import ImagePlus from "@lucide/svelte/icons/image-plus";
import Layers from "@lucide/svelte/icons/layers";
import Workflow from "@lucide/svelte/icons/workflow";
import type {
  ExtensionIcon,
  ExtensionLucideIcon,
} from "@nervekit/contracts/extensions";
import { cn } from "@nervekit/ui-kit/utils";
import type { Component } from "svelte";

type Glyph = Component<{ class?: string; "aria-hidden"?: "true" }>;

// Exhaustive on purpose: a new name in the contract fails the type check here.
const glyphs: Record<ExtensionLucideIcon, Glyph> = {
  blocks: Blocks,
  globe: Globe,
  "image-plus": ImagePlus,
  layers: Layers,
  workflow: Workflow,
};

let {
  icon,
  off = false,
  size = "tile",
}: {
  icon: ExtensionIcon;
  off?: boolean;
  size?: "tile" | "inline";
} = $props();

const Lucide = $derived(icon.type === "lucide" ? glyphs[icon.name] : undefined);
</script>

<span
  class={cn(
    "flex flex-none items-center justify-center",
    size === "tile" ? "size-8 rounded-md border bg-card" : "size-5",
    off ? "text-muted-foreground" : "text-foreground",
  )}
>
  {#if icon.type === "svg"}
    <img
      src={icon.src}
      alt=""
      draggable="false"
      class={cn("size-5", off && "grayscale")}
    />
  {:else if Lucide}
    <Lucide
      class={size === "tile" ? "size-4" : "size-4.5"}
      aria-hidden="true"
    />
  {/if}
</span>
