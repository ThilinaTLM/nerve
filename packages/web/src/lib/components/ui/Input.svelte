<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { cn } from "../../utils/cn";

  type Props = {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    readonly?: boolean;
    class?: string;
    type?: string;
    size?: "sm" | "md" | "lg";
    ariaLabel?: string;
    ariaLabelledby?: string;
    autocomplete?: HTMLInputAttributes["autocomplete"];
    name?: string;
    oninput?: (event: Event) => void;
    onkeydown?: (event: KeyboardEvent) => void;
  };

  let {
    value = $bindable(""),
    placeholder = "",
    disabled = false,
    readonly = false,
    class: className = "",
    type = "text",
    size = "md",
    ariaLabel,
    ariaLabelledby,
    autocomplete,
    name,
    oninput,
    onkeydown,
  }: Props = $props();
</script>

<input
  class={cn("ui-input", size, className)}
  bind:value
  {placeholder}
  {disabled}
  {readonly}
  {type}
  {autocomplete}
  {name}
  aria-label={ariaLabel}
  aria-labelledby={ariaLabelledby}
  {oninput}
  {onkeydown}
/>

<style>
  .ui-input {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    font-size: var(--text-sm);
    box-shadow: 0 1px 0 rgb(255 255 255 / 2%) inset;
    transition:
      border-color 120ms ease,
      background 120ms ease,
      box-shadow 120ms ease,
      opacity 120ms ease;
  }

  .sm {
    height: var(--control-height-sm);
    padding: 0.18rem 0.55rem;
    font-size: var(--text-xs);
  }

  .md {
    height: var(--control-height-md);
    padding: 0.28rem 0.65rem;
  }

  .lg {
    height: var(--control-height-lg);
    padding: 0.38rem 0.8rem;
    font-size: var(--text-md);
  }

  .ui-input:hover:not(:disabled):not(:read-only) {
    border-color: var(--color-border-strong);
  }

  .ui-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-ring-soft);
  }

  .ui-input::placeholder {
    color: var(--color-faint);
  }

  .ui-input:disabled,
  .ui-input:read-only {
    opacity: 0.66;
  }
</style>
