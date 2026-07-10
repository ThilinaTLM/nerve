<script lang="ts">
import type { Snippet } from "svelte";
import type { MetaItem } from "../../views/tool-presentation";

type Props = {
  meta?: MetaItem[];
  detailsAction?: { label: string; onClick: () => void };
  onOpenFile?: (path: string, line?: number) => void;
  /** Right-aligned action buttons (e.g. HIL accept/reject, reply/dismiss). */
  actions?: Snippet;
};
let { meta = [], detailsAction, onOpenFile, actions }: Props = $props();

const hasActions = $derived(Boolean(actions));
const show = $derived(meta.length > 0 || Boolean(detailsAction) || hasActions);
</script>

{#if show}
  <div class={`tool-footer${hasActions ? " has-actions" : ""}`}>
    {#if meta.length > 0}
      <div class="chips">
        {#each meta as item, i (i)}
          {#if item.openPath}
            <button
              class={`chip chip-action tone-${item.tone ?? "default"}`}
              type="button"
              title={item.openPath}
              onclick={() => onOpenFile?.(item.openPath!)}>{item.text}</button
            >
          {:else if item.href}
            <a
              class={`chip chip-action tone-${item.tone ?? "default"}`}
              href={item.href}
              target="_blank"
              rel="noreferrer noopener">{item.text}</a
            >
          {:else}
            <span class={`chip tone-${item.tone ?? "default"}`}
              >{item.text}</span
            >
          {/if}
        {/each}
      </div>
    {/if}
    {#if detailsAction}
      <button class="more" type="button" onclick={detailsAction.onClick}>
        {detailsAction.label}
      </button>
    {/if}
    {#if actions}
      <div class="footer-actions">{@render actions()}</div>
    {/if}
  </div>
{/if}

<style>
.tool-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 0.35rem 0.6rem;
  min-width: 0;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.footer-actions {
  margin-left: auto;
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

/* Footer pills: meta chips and the show-more button share one visual family. */
.chip,
.more {
  display: inline-flex;
  min-height: 1.25rem;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--sidebar);
  padding: 0.075rem 0.45rem;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
  text-decoration: none;
}

.chip {
  color: var(--muted-foreground);
}

.chip-action {
  cursor: pointer;
}

.chip-action:hover,
.more:hover {
  text-decoration: underline;
}

.chip.tone-success {
  color: var(--success);
  border-color: color-mix(in oklab, var(--success) 35%, var(--border));
}

.chip.tone-warning {
  color: var(--warning);
  border-color: color-mix(in oklab, var(--warning) 35%, var(--border));
}

.chip.tone-error {
  color: var(--destructive);
  border-color: color-mix(in oklab, var(--destructive) 35%, var(--border));
}

.chip.tone-info {
  color: var(--info);
  border-color: color-mix(in oklab, var(--info) 35%, var(--border));
}

.more {
  margin-left: auto;
  min-width: 0;
  max-width: 100%;
  flex: 0 1 auto;
  color: var(--primary);
  cursor: pointer;
  overflow-wrap: anywhere;
  text-align: left;
  white-space: normal;
}

.tool-footer.has-actions .more {
  margin-left: 0;
}
</style>
