<script lang="ts">
  import type { Snippet } from "svelte";
  import ContextMenu, {
    type ContextMenuItem,
  } from "@nervekit/workbench-ui/components/ui/context-menu-list";
  import { StatusDot, type StatusTone } from "@nervekit/workbench-ui/components/ui/status-dot";
  import * as Tooltip from "@nervekit/workbench-ui/components/ui/tooltip";

  let {
    title,
    subtitle,
    active = false,
    isOpen = false,
    statusTone = "neutral",
    statusPulse = false,
    statusLabel,
    mono = false,
    menuItems,
    tooltip,
    tooltipClass,
    onSelect,
  }: {
    title: string;
    subtitle?: string;
    active?: boolean;
    /** Renders the status dot as a solid (open) vs outline (closed) indicator. */
    isOpen?: boolean;
    statusTone?: StatusTone;
    statusPulse?: boolean;
    statusLabel?: string;
    /** Render the subtitle in a mono font. */
    mono?: boolean;
    menuItems?: ContextMenuItem[];
    /** Optional rich tooltip content shown to the right of the row. */
    tooltip?: Snippet;
    /** Extra class appended to the tooltip content (e.g. `conversation-tooltip`). */
    tooltipClass?: string;
    onSelect?: () => void;
  } = $props();
</script>

{#snippet row()}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props: tip })}
        <button
          {...tip}
          type="button"
          class="navigator-row"
          data-active={active}
          title={title}
          onclick={() => onSelect?.()}
        >
          <StatusDot
            class="navigator-status"
            tone={statusTone}
            pulse={statusPulse}
            label={statusLabel}
            variant={isOpen ? "solid" : "outline"}
            size="sm"
          />
          <span class="navigator-label">
            <span class="navigator-title">{title}</span>
            {#if subtitle}
              <span class="navigator-subtitle" class:mono>{subtitle}</span>
            {/if}
          </span>
        </button>
      {/snippet}
    </Tooltip.Trigger>
    {#if tooltip}
      <Tooltip.Content side="right" sideOffset={6} class={tooltipClass ? `nav-tooltip ${tooltipClass}` : "nav-tooltip"}>
        {@render tooltip()}
      </Tooltip.Content>
    {/if}
  </Tooltip.Root>
{/snippet}

{#if menuItems && menuItems.length > 0}
  <ContextMenu items={menuItems} triggerClass="navigator-context-trigger">
    {@render row()}
  </ContextMenu>
{:else}
  {@render row()}
{/if}

<style>
  :global(.navigator-context-trigger) {
    display: block;
    width: 100%;
    min-width: 0;
  }

  .navigator-row {
    display: flex;
    width: 100%;
    min-width: 0;
    align-items: center;
    gap: 0.5rem;
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.55rem;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
    transition:
      color 120ms ease,
      background-color 120ms ease;
  }

  .navigator-row:hover {
    background: color-mix(in oklab, var(--muted) 60%, transparent);
    color: var(--foreground);
  }

  .navigator-row[data-active="true"] {
    background: var(--accent);
    color: var(--accent-foreground);
  }

  .navigator-row:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--ring) 60%, transparent);
  }

  .navigator-label {
    display: flex;
    flex: 1 1 0;
    min-width: 0;
    max-width: 100%;
    flex-direction: column;
    gap: 0.05rem;
    overflow: hidden;
  }

  .navigator-title {
    display: block;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    font-weight: 400;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .navigator-subtitle {
    display: block;
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .navigator-subtitle.mono {
    font-family: var(--font-mono);
  }
</style>
