<script lang="ts">
import type { Snippet } from "svelte";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";

type Props = { label: string; children: Snippet };
let { label, children }: Props = $props();
</script>

<Tooltip.Provider delayDuration={300}>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <span {...props} class="inline-flex items-center">
          {@render children()}
        </span>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{label}</Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
