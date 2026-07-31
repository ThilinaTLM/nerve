<script lang="ts">
import RefreshCw from "@lucide/svelte/icons/refresh-cw";
import Trash2 from "@lucide/svelte/icons/trash-2";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { StoragePageController } from "./storage-page-state.svelte";

type Props = {
  controller: StoragePageController;
};

let { controller }: Props = $props();
</script>

<Button
  size="sm"
  variant="outline"
  disabled={controller.loading ||
    controller.refreshing ||
    (controller.operation?.cancellable === false && controller.active)}
  onclick={() => void controller.loadUsage(true)}
>
  <RefreshCw
    class={controller.refreshing ? "size-3.5 spin" : "size-3.5"}
    aria-hidden="true"
  />
  {controller.refreshing ? "Calculating…" : "Refresh"}
</Button>
<Button
  size="sm"
  disabled={!controller.usage ||
    controller.active ||
    controller.operationLoading}
  onclick={() => (controller.cleanupDialogOpen = true)}
>
  <Trash2 class="size-3.5" aria-hidden="true" />
  {controller.active ? "Cleanup running" : "Clean up"}
</Button>
