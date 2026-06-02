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
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.7rem 0.75rem;
    font-size: var(--text-sm);
    line-height: var(--leading-relaxed);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease,
      opacity 120ms ease;
  }

  .ui-textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-ring-soft);
  }

  .ui-textarea::placeholder {
    color: var(--color-faint);
  }

  .ui-textarea:disabled {
    opacity: 0.58;
  }
</style>
