<script lang="ts">
import { cn } from "@nervekit/ui-kit/utils";

type Props = { name: string | null | undefined; large?: boolean };
let { name, large = false }: Props = $props();
</script>

<span
  class={cn(
    "inline-flex shrink-0 items-center justify-center rounded-full bg-muted leading-none text-muted-foreground uppercase",
    large ? "size-6 text-ui font-medium" : "size-4 text-caption",
  )}
  aria-hidden="true">{(name ?? "?").slice(0, 1)}</span
>
