<!--
  An account's connection status, which is also its Test button: verified,
  a warning for restricted or unreachable, rejected, muted for not available,
  and a muted refresh glyph when not checked yet. The tooltip names the status,
  the check's reason and when it ran. Without `onTest` (no test, or read-only)
  it is a plain icon, shown only once there is a result.
-->
<script lang="ts">
import CircleCheck from "@lucide/svelte/icons/circle-check";
import CircleMinus from "@lucide/svelte/icons/circle-minus";
import CircleX from "@lucide/svelte/icons/circle-x";
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { AccountHealth } from "@nervekit/contracts/auth";
import { IconAction } from "@nervekit/ui-kit/components/composites/icon-action";
import * as Tooltip from "@nervekit/ui-kit/components/ui/tooltip";
import { accountHealthIndicator, healthSummary } from "./account-health";

let {
  health,
  busy = false,
  onTest,
}: {
  health: AccountHealth | undefined;
  busy?: boolean;
  /** Runs the connection test; the icon becomes its button. */
  onTest?: () => void;
} = $props();

const indicator = $derived(accountHealthIndicator(health));
const Icon = $derived(
  indicator?.icon === "circle-check"
    ? CircleCheck
    : indicator?.icon === "circle-x"
      ? CircleX
      : indicator?.icon === "circle-minus"
        ? CircleMinus
        : indicator
          ? TriangleAlert
          : RefreshCw,
);
const summary = $derived(health ? healthSummary(health) : undefined);
</script>

{#if onTest}
  <IconAction
    icon={Icon}
    class={indicator?.class}
    label={busy
      ? "Testing connection…"
      : summary
        ? `${summary} · Test again`
        : "Not checked · Test connection"}
    {busy}
    onclick={onTest}
  />
{:else if indicator && summary}
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
      <Tooltip.Content>{summary}</Tooltip.Content>
    </Tooltip.Root>
  </Tooltip.Provider>
{/if}
