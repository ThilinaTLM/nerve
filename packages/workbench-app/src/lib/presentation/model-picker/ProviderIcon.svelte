<!--
  A model provider's mark, sized like a Lucide icon (1em by default, set with
  `class`). Unknown providers get a generic glyph so rows keep their rhythm.
-->
<script lang="ts">
import Boxes from "@lucide/svelte/icons/boxes";
import { cn } from "@nervekit/ui-kit/utils";
import { providerMarkId, providerMarks } from "./provider-marks";

let {
  provider,
  class: className,
}: {
  provider: string;
  class?: string;
} = $props();

const uid = $props.id();
const mark = $derived.by(() => {
  const id = providerMarkId(provider);
  return id ? providerMarks[id] : undefined;
});
/* Gradient and mask ids must stay unique when several marks share a page. */
const body = $derived(
  mark?.body
    .replaceAll(/id="([^"]+)"/g, `id="${uid}-$1"`)
    .replaceAll(/url\(#([^)]+)\)/g, `url(#${uid}-$1)`),
);
</script>

{#if mark}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox={mark.viewBox}
    {...mark.attrs}
    class={cn("size-3.5 flex-none", className)}
    aria-hidden="true"
    focusable="false"
  >
    <!-- eslint-disable-next-line svelte/no-at-html-tags -- static, repository-owned SVG -->
    {@html body}
  </svg>
{:else}
  <Boxes
    class={cn("size-3.5 flex-none text-muted-foreground", className)}
    aria-hidden="true"
  />
{/if}
