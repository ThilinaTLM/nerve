<script lang="ts">
import * as ContextMenu from "@nervekit/ui-kit/components/ui/context-menu";

let { class: className }: { class?: string } = $props();
</script>

<ContextMenu.Separator class={className} />
