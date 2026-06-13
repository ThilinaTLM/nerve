<script lang="ts">
  import type { SubscriptionUsage, SubscriptionWindow } from "$lib/api";
  import {
    formatResetAfterSeconds,
    formatResetAt,
    usageTone,
  } from "$lib/utils/usage";
  import Popover from "$lib/components/ui/popover-panel";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import type { StatusTone } from "$lib/utils/status";

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

  function percentLabel(value: number | null | undefined): string {
    return value == null ? "—" : `${Math.round(value)}%`;
  }

  function providerLabel(provider: string | undefined): string {
    if (provider === "openai-codex") return "Codex";
    if (provider === "anthropic") return "Anthropic";
    return provider ?? "Subscription";
  }

  function updatedLabel(value: string | undefined): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function triggerTone(
    sessionPercent: number | null,
    weeklyPercent: number | null,
  ): StatusTone {
    const highest = Math.max(sessionPercent ?? 0, weeklyPercent ?? 0);
    const tone = usageTone(highest);
    if (tone === "error") return "danger";
    if (tone === "warning") return "warn";
    return "good";
  }

  const session = $derived(usage?.session ?? null);
  const weekly = $derived(usage?.weekly ?? null);
  const sessionPercent = $derived(session?.usedPercent ?? null);
  const weeklyPercent = $derived(weekly?.usedPercent ?? null);
  const sessionReset = $derived(windowReset(session));
  const weeklyReset = $derived(windowReset(weekly));
  const provider = $derived(providerLabel(usage?.provider));
  const tone = $derived(triggerTone(sessionPercent, weeklyPercent));
  const hasData = $derived(
    sessionPercent != null || sessionReset != null || weeklyPercent != null,
  );
  const title = $derived.by(() => {
    if (!usage) return "";
    const lines: string[] = [];
    lines.push(`${provider} subscription usage`);
    if (sessionPercent != null) {
      lines.push(
        `Session: ${percentLabel(sessionPercent)}${sessionReset ? ` (resets ${sessionReset})` : ""}`,
      );
    }
    if (weeklyPercent != null) {
      lines.push(
        `Weekly: ${percentLabel(weeklyPercent)}${weeklyReset ? ` (resets ${weeklyReset})` : ""}`,
      );
    }
    return lines.join("\n");
  });
</script>

{#if hasData}
  <Popover
    class="subscription-popover"
    triggerClass="subscription-trigger-wrap"
    ariaLabel="Open subscription usage details"
    side="top"
    align="end"
  >
    {#snippet trigger()}
      <span class="subscription-trigger" {title}>
        <StatusDot {tone} pulse={tone !== "good"} size="xs" />
        <span class="trigger-part" data-tone={usageTone(sessionPercent)}>
          S:{percentLabel(sessionPercent)}{#if sessionReset != null} <span class="trigger-reset">({sessionReset})</span>{/if}
        </span>
        {#if weeklyPercent != null}
          <span class="trigger-sep">/</span>
          <span class="trigger-part" data-tone={usageTone(weeklyPercent)}>
            W:{percentLabel(weeklyPercent)}
          </span>
        {/if}
      </span>
    {/snippet}

    <div class="usage-card">
      <header>
        <div>
          <strong>Subscription usage</strong>
          <span>{provider}{#if usage?.planType} · {usage.planType}{/if}</span>
        </div>
        <span class="usage-pill"><StatusDot {tone} size="xs" />{provider}</span>
      </header>

      <div class="usage-grid">
        <section>
          <span>Session usage</span>
          <strong data-tone={usageTone(sessionPercent)}>{percentLabel(sessionPercent)}</strong>
        </section>
        <section>
          <span>Session reset</span>
          <strong>{sessionReset ?? "—"}</strong>
        </section>
        <section>
          <span>Weekly usage</span>
          <strong data-tone={usageTone(weeklyPercent)}>{percentLabel(weeklyPercent)}</strong>
        </section>
        <section>
          <span>Weekly reset</span>
          <strong>{weeklyReset ?? "—"}</strong>
        </section>
      </div>

      <div class="usage-list">
        <div><span>Updated</span><strong>{updatedLabel(usage?.updatedAt)}</strong></div>
        <div><span>Session window</span><strong>{session?.windowMinutes ? `${session.windowMinutes}m` : "reset countdown"}</strong></div>
        <div><span>Weekly window</span><strong>{weekly?.windowMinutes ? `${weekly.windowMinutes}m` : "—"}</strong></div>
      </div>
    </div>
  </Popover>
{/if}

<style>
  .subscription-trigger {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    height: 100%;
    color: var(--muted-foreground);
    padding: 0 0.6rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    white-space: nowrap;
  }

  :global(.subscription-trigger-wrap) {
    height: 100%;
  }

  :global(.subscription-trigger-wrap:hover),
  :global(.subscription-trigger-wrap[data-state="open"]) {
    background: var(--accent);
  }

  :global(.subscription-trigger-wrap:hover) .subscription-trigger,
  :global(.subscription-trigger-wrap[data-state="open"]) .subscription-trigger {
    color: var(--foreground);
  }

  .trigger-sep,
  .trigger-reset {
    color: var(--muted-foreground);
  }

  .trigger-part[data-tone="warning"],
  .usage-grid strong[data-tone="warning"] {
    color: var(--warning);
  }

  .trigger-part[data-tone="error"],
  .usage-grid strong[data-tone="error"] {
    color: var(--destructive);
  }

  .usage-card {
    display: grid;
    gap: 0.7rem;
    padding: 0.75rem;
  }

  header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 0.8rem;
    border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    padding-bottom: 0.65rem;
  }

  header div,
  .usage-list div {
    display: grid;
    min-width: 0;
    gap: 0.1rem;
  }

  header strong {
    font-size: var(--text-sm);
    font-weight: 600;
  }

  header span,
  .usage-grid span,
  .usage-list span {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .usage-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: 999px;
    background: var(--input);
    padding: 0.12rem 0.45rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .usage-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.42rem;
  }

  .usage-grid section {
    display: grid;
    gap: 0.16rem;
    border: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    border-radius: var(--radius-sm);
    background: var(--input);
    padding: 0.55rem;
  }

  .usage-grid strong,
  .usage-list strong {
    overflow: hidden;
    color: var(--foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .usage-list {
    display: grid;
    gap: 0.36rem;
    border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
    padding-top: 0.6rem;
  }
</style>
