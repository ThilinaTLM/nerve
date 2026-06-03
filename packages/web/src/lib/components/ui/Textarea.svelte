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

<textarea
  class={cn(
    "w-full min-h-28 resize-y rounded-md border border-input bg-input/40 px-3 py-2.5 text-sm leading-relaxed text-foreground transition-colors placeholder:text-muted-foreground/70 focus:outline-none focus:border-ring focus:ring-1 focus:ring-ring disabled:opacity-60",
    className,
  )}
  bind:value
  {placeholder}
  {disabled}
  {rows}
  aria-label={ariaLabel}
  {oninput}
></textarea>
