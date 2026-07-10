<script lang="ts">
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";

let {
  id,
  checked = $bindable(false),
  title,
  description,
}: {
  id: string;
  checked?: boolean;
  title: string;
  description: string;
} = $props();
</script>

<div class="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 p-3">
  <Checkbox {id} bind:checked aria-label={title} />
  <label for={id} class="min-w-0 cursor-pointer">
    <span class="block text-sm font-medium">{title}</span>
    <span class="block text-xs text-muted-foreground">{description}</span>
  </label>
</div>
