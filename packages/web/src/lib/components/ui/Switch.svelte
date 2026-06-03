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
    color: hsl(var(--foreground));
    font-size: var(--text-sm);
  }

  .switch-copy {
    display: grid;
    min-width: 0;
    gap: 0.08rem;
  }

  .switch-copy small {
    color: hsl(var(--muted-foreground));
    font-size: var(--text-xs);
  }

  :global(.switch-root) {
    position: relative;
    flex: none;
    width: 2.25rem;
    height: 1.25rem;
    border: 1px solid hsl(var(--border));
    border-radius: 999px;
    background: hsl(var(--input));
    cursor: pointer;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      opacity 120ms ease;
  }

  :global(.switch-root[data-state="checked"]) {
    border-color: hsl(var(--primary));
    background: hsl(var(--primary));
  }

  :global(.switch-root:focus-visible) {
    outline: 1px solid hsl(var(--ring));
    outline-offset: 2px;
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
    background: hsl(var(--muted-foreground));
    transform: translate(0.16rem, 0.13rem);
    transition:
      transform 120ms ease,
      background 120ms ease;
  }

  :global(.switch-root[data-state="checked"] .switch-thumb) {
    background: hsl(var(--primary-foreground));
    transform: translate(1.08rem, 0.13rem);
  }
</style>
