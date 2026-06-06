<script lang="ts">
  import type { SubscriptionUsage, SubscriptionWindow } from "../../api";
  import {
    formatResetAfterSeconds,
    formatResetAt,
    usageTone,
  } from "../../utils/usage";

  type Props = {
    usage?: SubscriptionUsage;
  };

  let { usage }: Props = $props();

  function windowReset(window: SubscriptionWindow | null): string | null {
    if (!window) return null;
    return (
      formatResetAt(window.resetsAt) ??
      formatResetAfterSeconds(window.resetAfterSeconds)
    );
  }

  const session = $derived(usage?.session ?? null);
  const weekly = $derived(usage?.weekly ?? null);
  const sessionPercent = $derived(session?.usedPercent ?? null);
  const weeklyPercent = $derived(weekly?.usedPercent ?? null);

  const hasData = $derived(sessionPercent != null || weeklyPercent != null);

  const title = $derived.by(() => {
    if (!usage) return "";
    const lines: string[] = [];
    if (sessionPercent != null) {
      const reset = windowReset(session);
      lines.push(
        `Session: ${Math.round(sessionPercent)}%${reset ? ` (resets ${reset})` : ""}`,
      );
    }
    if (weeklyPercent != null) {
      const reset = windowReset(weekly);
      lines.push(
        `Weekly: ${Math.round(weeklyPercent)}%${reset ? ` (resets ${reset})` : ""}`,
      );
    }
    return lines.join("\n");
  });
</script>

{#if hasData}
  <span class="footer-chip sub-chip" {title}>
    {#if sessionPercent != null}
      <span class="sub-part" data-tone={usageTone(sessionPercent)}>
        S {Math.round(sessionPercent)}%
      </span>
    {/if}
    {#if weeklyPercent != null}
      <span class="sub-sep">·</span>
      <span class="sub-part" data-tone={usageTone(weeklyPercent)}>
        W {Math.round(weeklyPercent)}%
      </span>
    {/if}
  </span>
{/if}

<style>
  .sub-chip {
    gap: 0.3rem;
    font-family: var(--font-mono);
  }

  .sub-sep {
    color: var(--muted-foreground);
  }

  .sub-part[data-tone="neutral"] {
    color: var(--muted-foreground);
  }

  .sub-part[data-tone="warning"] {
    color: var(--warning);
  }

  .sub-part[data-tone="error"] {
    color: var(--destructive);
  }
</style>
