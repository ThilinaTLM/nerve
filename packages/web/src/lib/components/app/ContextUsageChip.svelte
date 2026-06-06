<script lang="ts">
  import type { ContextUsage } from "../../api";
  import { formatTokens, usageTone } from "../../utils/usage";

  type CumulativeUsage = {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };

  type Props = {
    contextUsage?: ContextUsage;
    contextWindow?: number;
    cumulative?: CumulativeUsage;
  };

  let { contextUsage, contextWindow = 0, cumulative }: Props = $props();

  const window = $derived(contextUsage?.contextWindow || contextWindow || 0);
  const percent = $derived(contextUsage?.percent ?? null);
  const tone = $derived(usageTone(percent));

  const stats = $derived.by(() => {
    const parts: string[] = [];
    if (!cumulative) return parts;
    if (cumulative.input) parts.push(`↑${formatTokens(cumulative.input)}`);
    if (cumulative.output) parts.push(`↓${formatTokens(cumulative.output)}`);
    if (cumulative.cacheRead) parts.push(`R${formatTokens(cumulative.cacheRead)}`);
    if (cumulative.cacheWrite) parts.push(`W${formatTokens(cumulative.cacheWrite)}`);
    if (cumulative.cost) parts.push(`$${cumulative.cost.toFixed(3)}`);
    return parts;
  });

  const percentLabel = $derived(percent == null ? "?" : `${percent.toFixed(1)}%`);
  const windowLabel = $derived(window > 0 ? formatTokens(window) : "—");
  const title = $derived(
    contextUsage?.tokens != null && window > 0
      ? `Context: ${contextUsage.tokens.toLocaleString()} / ${window.toLocaleString()} tokens`
      : "Context usage unknown until the next response",
  );
</script>

{#if window > 0 || stats.length > 0}
  <span class="footer-chip context-chip" {title}>
    {#each stats as part (part)}
      <span class="ctx-stat">{part}</span>
    {/each}
    {#if window > 0}
      <span class="ctx-context" data-tone={tone}>{percentLabel}/{windowLabel}</span>
    {/if}
  </span>
{/if}

<style>
  .context-chip {
    gap: 0.4rem;
    font-family: var(--font-mono);
  }

  .ctx-stat {
    color: var(--muted-foreground);
  }

  .ctx-context[data-tone="neutral"] {
    color: var(--muted-foreground);
  }

  .ctx-context[data-tone="warning"] {
    color: var(--warning);
  }

  .ctx-context[data-tone="error"] {
    color: var(--destructive);
  }
</style>
