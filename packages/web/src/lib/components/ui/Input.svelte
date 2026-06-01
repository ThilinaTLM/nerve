<script lang="ts">
  type Props = {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    class?: string;
    type?: string;
    ariaLabel?: string;
    oninput?: (event: Event) => void;
  };

  let {
    value = $bindable(),
    placeholder = "",
    disabled = false,
    class: className = "",
    type = "text",
    ariaLabel,
    oninput,
  }: Props = $props();
</script>

<input class={`ui-input ${className}`} bind:value {placeholder} {disabled} {type} aria-label={ariaLabel} {oninput} />

<style>
  .ui-input {
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-field);
    color: var(--color-text);
    padding: 0.34rem 0.5rem;
    font-size: 0.78rem;
    transition:
      border-color 140ms ease,
      box-shadow 140ms ease,
      opacity 140ms ease;
  }

  .ui-input:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-ring-soft);
  }

  .ui-input::placeholder {
    color: var(--color-faint);
  }

  .ui-input:disabled {
    opacity: 0.6;
  }
</style>
