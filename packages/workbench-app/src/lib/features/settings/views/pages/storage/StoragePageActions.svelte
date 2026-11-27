<script lang="ts">
import Eraser from "@lucide/svelte/icons/eraser";
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
  disabled={!controller.usage || controller.active}
  onclick={() => controller.openCleanup()}
>
  <Eraser class="size-3.5" aria-hidden="true" />
  Clean up
</Button>
