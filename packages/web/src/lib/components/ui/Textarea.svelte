<script lang="ts">
  import { cn } from "../../utils/cn";

  type Props = {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    class?: string;
    rows?: number;
    ariaLabel?: string;
    oninput?: (event: Event) => void;
  };

  let {
    value = $bindable(""),
    placeholder = "",
    disabled = false,
    class: className = "",
    rows = 4,
    ariaLabel,
    oninput,
  }: Props = $props();
</script>

<textarea class={cn("ui-textarea", className)} bind:value {placeholder} {disabled} {rows} aria-label={ariaLabel} {oninput}></textarea>

<style>
  .ui-textarea {
    width: 100%;
    min-height: 7rem;
    resize: vertical;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.72rem 0.85rem;
    line-height: 1.55;
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease,
      opacity 140ms ease;
  }

  .ui-textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px var(--color-ring-soft);
  }

  .ui-textarea:disabled {
    opacity: 0.58;
  }
</style>
