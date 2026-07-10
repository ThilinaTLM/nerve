<script lang="ts">
import { cn } from "@nervekit/workbench-ui/core/utils";

type Props = {
  text: string;
  class?: string;
};

let { text, class: className = "" }: Props = $props();
</script>

<div
  class={cn("min-w-0 max-w-full whitespace-pre-wrap break-words", className)}
>
  {text}
</div>
