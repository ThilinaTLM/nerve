<script lang="ts">
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";

let { label, class: className }: { label: string; class?: string } = $props();
</script>

<ContextMenu.Group>
  <ContextMenu.GroupHeading class={className}>{label}</ContextMenu.GroupHeading>
</ContextMenu.Group>
