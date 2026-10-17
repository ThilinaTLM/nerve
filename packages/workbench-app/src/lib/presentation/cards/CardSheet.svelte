<script lang="ts">
import type { Snippet } from "svelte";
import { cn } from "@nervekit/ui-kit/utils";
import { provideCardSheet } from "./sheet-context";

type Props = {
  class?: string;
  children?: Snippet;
};
let { class: className, children }: Props = $props();

provideCardSheet();
</script>

<!-- One recessed sheet per card; each direct child is a hairline-divided section. -->
<div
  class={cn(
    "min-w-0 overflow-hidden rounded-sm border bg-well [&>*+*]:border-t",
    className,
  )}
>
  {@render children?.()}
</div>
