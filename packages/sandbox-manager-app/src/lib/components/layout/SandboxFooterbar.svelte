<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import LoaderCircle from "@lucide/svelte/icons/loader-circle";
import type { ManagedSandboxRecord } from "@nervekit/contracts";
import { StatusDot } from "@nervekit/ui-kit/components/ui/status-dot";
import type { StatusTone } from "@nervekit/ui-kit/components/ui/status-dot";
import { WorkbenchFooterbar } from "@nervekit/workbench-ui/components/workbench";
import {
  pendingApprovalRecords,
  pendingUserQuestionRecord,
} from "../../state/sandbox-review-records";
import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";

let {
  record,
  sandboxId,
  sidebarCollapsed = false,
  utilityCollapsed = false,
  phone = false,
  onToggleSidebar,
  onToggleUtility,
}: {
  record?: ManagedSandboxRecord;
  sandboxId: string;
  sidebarCollapsed?: boolean;
  utilityCollapsed?: boolean;
  phone?: boolean;
  onToggleSidebar?: () => void;
  onToggleUtility?: () => void;
} = $props();

const store = useSandboxManagerStore();
const detail = $derived(store.details[sandboxId]);
const richState = $derived(
  detail?.selectedConversationId
    ? detail.conversationViewsById[detail.selectedConversationId]
    : Object.values(detail?.conversationViewsById ?? {})[0],
);
const approvals = $derived(pendingApprovalRecords(detail, richState));
const question = $derived(pendingUserQuestionRecord(detail, richState));
const pendingReviewCount = $derived(approvals.length + (question ? 1 : 0));
const pendingOps = $derived(
  Object.values(store.pendingOperations).filter(
    (operation) =>
      operation.status === "pending" &&
      (!operation.sandboxId || operation.sandboxId === sandboxId),
  ).length,
);
const connectionTone = $derived<StatusTone>(
  store.connection === "live"
    ? "good"
    : store.connection === "connecting" || store.connection === "reconnecting"
      ? "running"
      : store.connection === "error"
        ? "danger"
        : "neutral",
);
</script>

<WorkbenchFooterbar
  {sidebarCollapsed}
  {utilityCollapsed}
  sidebarLabel="sandbox navigator"
  utilityLabel="sandbox utility panel"
  {onToggleSidebar}
  {onToggleUtility}
>
  {#snippet left()}
    {#if record}
      <span class="footer-project-path" title={record.sandboxId}
        >{record.name ?? record.sandboxId}</span
      >
      {#if !phone}
        <span class="footer-chip">{record.observedState}</span>
      {/if}
    {/if}
  {/snippet}

  {#snippet right()}
    {#if !phone}
      {#if pendingOps > 0}
        <span class="footer-chip" title="Pending operations"
          ><LoaderCircle size={12} strokeWidth={2.1} /> {pendingOps}</span
        >
      {/if}
      {#if pendingReviewCount > 0}
        <span class="footer-chip warn" title="Pending review"
          ><TriangleAlert size={12} strokeWidth={2.1} />
          {pendingReviewCount}</span
        >
      {/if}
    {/if}
    <span class="footer-chip" title={`Connection: ${store.connection}`}>
      <StatusDot
        tone={connectionTone}
        pulse={store.connection === "connecting" ||
          store.connection === "reconnecting"}
        size="xs"
      />
      <span>{store.connection}</span>
    </span>
  {/snippet}
</WorkbenchFooterbar>
