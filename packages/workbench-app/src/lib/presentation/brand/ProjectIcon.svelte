<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  projectId: string;
  /** Project name; its first letter is the fallback when the project has no icon. */
  name: string;
  class?: string;
};

let { projectId, name, class: className }: Props = $props();
let failed = $state(false);
const source = $derived(
  `/api/projects/${encodeURIComponent(projectId)}/icon?v=2`,
);
const initial = $derived(
  (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toLocaleUpperCase(),
);
</script>

<span
  class={cn(
    "relative grid shrink-0 place-items-center overflow-hidden rounded-md border border-border-subtle bg-muted text-muted-foreground",
    className,
  )}
  aria-hidden="true"
>
  <!-- An SVG monogram scales with whatever size the caller gives the icon. -->
  <svg viewBox="0 0 24 24" class="size-full">
    <text
      x="12"
      y="12.5"
      text-anchor="middle"
      dominant-baseline="central"
      font-size="13"
      font-weight="600"
      fill="currentColor">{initial}</text
    >
  </svg>
  {#if !failed}
    <img
      src={source}
      alt=""
      loading="lazy"
      decoding="async"
      class="absolute inset-0 size-full bg-muted object-cover"
      onerror={() => (failed = true)}
    />
  {/if}
</span>
