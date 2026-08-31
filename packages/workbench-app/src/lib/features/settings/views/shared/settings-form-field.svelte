<script lang="ts">
import type { Snippet } from "svelte";
import { Label } from "@nervekit/ui-kit/components/ui/label";
import { cn } from "@nervekit/ui-kit/utils";

let {
  id,
  label,
  class: className,
  children,
}: {
  id?: string;
  label: string;
  class?: string;
  children: Snippet;
} = $props();
</script>

<div class={cn("grid gap-1.5", className)}>
  <Label for={id}>{label}</Label>
  {@render children()}
</div>
