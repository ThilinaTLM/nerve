<script lang="ts">
  import { Switch as SwitchPrimitive } from "bits-ui";
  import { cn } from "../../utils/cn";

  type Props = {
    checked?: boolean;
    disabled?: boolean;
    label?: string;
    description?: string;
    class?: string;
    onCheckedChange?: (checked: boolean) => void;
  };

  let {
    checked = $bindable(false),
    disabled = false,
    label,
    description,
    class: className = "",
    onCheckedChange,
  }: Props = $props();

  function handleCheckedChange(next: boolean) {
    checked = next;
    onCheckedChange?.(next);
  }
</script>

<label class={cn("ui-switch-row", className)}>
  <span class="switch-copy">
    {#if label}<span>{label}</span>{/if}
    {#if description}<small>{description}</small>{/if}
  </span>
  <SwitchPrimitive.Root class="switch-root" bind:checked {disabled} onCheckedChange={handleCheckedChange} aria-label={label}>
    <SwitchPrimitive.Thumb class="switch-thumb" />
  </SwitchPrimitive.Root>
</label>

<style>
  .ui-switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    color: var(--color-text);
    font-size: 0.78rem;
  }

  .switch-copy {
    display: grid;
    min-width: 0;
    gap: 0.08rem;
  }

  .switch-copy small {
    color: var(--color-muted);
    font-size: 0.7rem;
  }

  :global(.switch-root) {
    position: relative;
    flex: none;
    width: 2.18rem;
    height: 1.18rem;
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-field);
    cursor: pointer;
    transition:
      background 140ms ease,
      border-color 140ms ease,
      opacity 140ms ease;
  }

  :global(.switch-root[data-state="checked"]) {
    border-color: var(--color-accent);
    background: var(--color-accent-soft);
  }

  :global(.switch-root[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.55;
  }

  :global(.switch-thumb) {
    display: block;
    width: 0.82rem;
    height: 0.82rem;
    border-radius: 999px;
    background: var(--color-muted);
    transform: translate(0.16rem, 0.13rem);
    transition:
      transform 140ms ease,
      background 140ms ease;
  }

  :global(.switch-root[data-state="checked"] .switch-thumb) {
    background: var(--color-accent);
    transform: translate(1.05rem, 0.13rem);
  }
</style>
