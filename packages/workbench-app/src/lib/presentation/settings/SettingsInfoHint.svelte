<script lang="ts">
import Info from "@lucide/svelte/icons/info";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";

type Props = {
  /** Detail that would otherwise sit under the heading as a description. */
  text: string;
  label?: string;
};

let { text, label = "More information" }: Props = $props();
</script>

<Tooltip.Provider delayDuration={200}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          aria-label={label}
          class="inline-flex flex-none cursor-help items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Info class="size-3.5" aria-hidden="true" />
        </button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="top" class="max-w-xs">{text}</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
