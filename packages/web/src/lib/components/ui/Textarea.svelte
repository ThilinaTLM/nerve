<script lang="ts">
  type Props = {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    class?: string;
    rows?: number;
  };

  let {
    value = $bindable(""),
    placeholder = "",
    disabled = false,
    class: className = "",
    rows = 4,
  }: Props = $props();
</script>

<textarea class={`ui-textarea ${className}`} bind:value {placeholder} {disabled} {rows}></textarea>

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
  }

  .ui-textarea:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 0 3px var(--color-ring-soft);
  }
</style>
