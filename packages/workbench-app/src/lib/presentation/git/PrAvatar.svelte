<script lang="ts">
import { cn } from "@nervekit/ui-kit/core/utils";

type Props = {
  name?: string | null;
  src?: string;
  class?: string;
};

let { name, src, class: className }: Props = $props();

let failed = $state(false);
const initials = $derived((name ?? "?").trim().slice(0, 1).toUpperCase());
</script>

<span
  class={cn(
    "grid shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-muted-foreground",
    className,
  )}
  title={name ?? undefined}
>
  {#if src && !failed}
    <img
      {src}
      alt={name ?? "Avatar"}
      loading="lazy"
      referrerpolicy="no-referrer"
      class="size-full object-cover"
      onerror={() => (failed = true)}
    />
  {:else}
    {initials}
  {/if}
</span>
