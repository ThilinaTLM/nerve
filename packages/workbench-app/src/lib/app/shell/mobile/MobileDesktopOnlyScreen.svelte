<script lang="ts">
import Monitor from "@lucide/svelte/icons/monitor";
import { PageEmptyState } from "@nervekit/ui-kit/components/composites/page";
import { MobileScreen } from "$lib/presentation/shell";
import { backFromMobileScreen } from "./mobile-shell.svelte";

/**
 * Where a link into a desktop-only area (logs, configuration) lands on a
 * phone, so it explains itself instead of failing.
 */
let { title }: { title: string } = $props();
</script>

<MobileScreen {title} onBack={backFromMobileScreen} backLabel="Back">
  <div class="px-3 py-3">
    <PageEmptyState
      icon={Monitor}
      title="Available on desktop"
      description={`Open ${title} in Nerve on a computer.`}
    />
  </div>
</MobileScreen>
