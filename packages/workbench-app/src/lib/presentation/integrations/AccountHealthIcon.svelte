<!--
  The status icon that follows an account's name: verified, a warning for
  restricted or unreachable, rejected, muted for not available; nothing when not checked or the kind has
  no test. Its tooltip names the status and when it was checked.
-->
<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleMinus from "@lucide/svelte/icons/circle-minus";
import CircleX from "@lucide/svelte/icons/circle-x";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { AccountHealth } from "@nervekit/contracts/auth";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { accountHealthIndicator, formatChecked } from "./account-health";

let { health }: { health: AccountHealth | undefined } = $props();

const indicator = $derived(accountHealthIndicator(health));
const Icon = $derived(
  indicator?.icon === "circle-check"
    ? CircleCheck
    : indicator?.icon === "circle-x"
      ? CircleX
      : indicator?.icon === "circle-minus"
        ? CircleMinus
        : TriangleAlert,
);
</script>

{#if indicator && health}
  <Tooltip.Provider delayDuration={300}>
    <Tooltip.Root>
      <Tooltip.Trigger>
        {#snippet child({ props })}
          <span {...props} class="inline-flex">
            <Icon class={`size-3.5 ${indicator.class}`} aria-hidden="true" />
            <span class="sr-only">{indicator.label}</span>
          </span>
        {/snippet}
      </Tooltip.Trigger>
      <Tooltip.Content
        >{indicator.label} · {formatChecked(health.checkedAt)}</Tooltip.Content
      >
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}
