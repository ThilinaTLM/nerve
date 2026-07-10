<script lang="ts">
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import GithubPrPane from "@nervekit/workbench-ui/git/GithubPrPane.svelte";
import { notify } from "@nervekit/ui-kit/core/notify";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

let {
  record,
  viewId,
}: {
  record: ManagedSandboxRecord;
  viewId: string;
} = $props();

const store = useSandboxManagerStore();
const detail = $derived(store.details[record.sandboxId]);
const view = $derived(detail?.prViewsById[viewId]);

function openExternal(): void {
  if (view?.detail?.url) window.open(view.detail.url, "_blank", "noreferrer");
}

async function checkout(): Promise<void> {
  if (!view) return;
  try {
    await store.checkoutSandboxPr(record.sandboxId, view.repo, view.number);
    notify.success(`Checked out PR #${view.number}`);
  } catch (error) {
    notify.error("Could not check out PR", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
</script>

<GithubPrPane
  {view}
  onRefresh={() =>
    view && store.refreshSandboxPr(record.sandboxId, view.repo, view.number)}
  onCheckout={() => void checkout()}
  onOpenExternal={openExternal}
/>
