<script lang="ts">
import Plus from "@lucide/svelte/icons/plus";
import { ConversationSignal } from "@nervekit/workbench-ui";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import SandboxSummaryCards from "../SandboxSummaryCards.svelte";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
import { filteredSandboxes } from "../../state/sandbox-manager-selectors.svelte";

const store = useSandboxManagerStore();
const sandboxes = $derived(filteredSandboxes(store));
</script>

<div class="flex h-full min-h-0 flex-col overflow-auto bg-background p-4">
  <div class="mx-auto w-full max-w-3xl">
    <SandboxSummaryCards />
  </div>
  <div class="flex min-h-0 flex-1 items-center justify-center">
    <ConversationSignal
      title="Where should we start?"
      message={sandboxes.length > 0
        ? "Open a sandbox from the navigator to continue, or spin up a fresh one."
        : "Spin up a sandbox to explore, plan, and build in an isolated container."}
    >
      {#snippet footer()}
        <Button onclick={() => (store.createDialogOpen = true)}>
          <Plus aria-hidden="true" />
          New sandbox
        </Button>
      {/snippet}
    </ConversationSignal>
  </div>
</div>
