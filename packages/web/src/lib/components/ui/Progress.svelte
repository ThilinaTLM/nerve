<script lang="ts">
  import { Progress } from "bits-ui";
  import { cn } from "../../utils/cn";

  type Props = {
    value?: number | null;
    max?: number;
    class?: string;
  };

  let { value = 0, max = 100, class: className = "" }: Props = $props();

  const pct = $derived(
    value == null ? null : Math.max(0, Math.min(100, (value / max) * 100)),
  );
</script>

<Progress.Root
  {value}
  {max}
  class={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)}
>
  <div
    class={cn(
      "h-full rounded-full bg-primary transition-[width] duration-300",
      pct == null && "w-2/5 animate-pulse",
    )}
    style={pct == null ? undefined : `width: ${pct}%`}
  ></div>
</Progress.Root>
