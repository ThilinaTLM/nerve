<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import X from "@lucide/svelte/icons/x";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import type { ApprovalWithToolCall } from "../../../state/tool-types";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import type { ToolArgumentPresentation } from "../../lifecycle/registry";
import type { MetaItem, MetaTone } from "../../views/tool-presentation";
import ToolApprovalSummary from "./ToolApprovalSummary.svelte";
import ToolFooter from "./ToolFooter.svelte";

type Props = {
  approval: ApprovalWithToolCall;
  toolName: string;
  presentation: ToolArgumentPresentation;
  /** False when the card's argument section already shows the body. */
  includeBody?: boolean;
  detailsAction?: { label: string; onClick: () => void };
  onGrantApproval?: (id: string) => void | Promise<void>;
  onDenyApproval?: (id: string) => void | Promise<void>;
};
let {
  approval,
  toolName,
  presentation,
  includeBody = true,
  detailsAction,
  onGrantApproval,
  onDenyApproval,
}: Props = $props();

let decision = $state<"approve" | "deny" | undefined>();
let actionError = $state<string | undefined>();

async function decide(kind: "approve" | "deny") {
  // One shared in-flight state covers both choices and rejects duplicates.
  if (decision) return;
  const callback = kind === "approve" ? onGrantApproval : onDenyApproval;
  if (!callback) return;
  decision = kind;
  actionError = undefined;
  try {
    await callback(approval.id);
  } catch (error) {
    actionError =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Could not resolve the approval.";
  } finally {
    decision = undefined;
  }
}

function riskTone(risk: string | undefined): MetaTone {
  if (risk === "destructive" || risk === "secret" || risk === "deployment")
    return "error";
  if (risk === "command" || risk === "network" || risk === "workspace_write")
    return "warning";
  if (risk === "agent_spawn") return "info";
  return "default";
}

const meta = $derived<MetaItem[]>([
  ...presentation.secondary,
  { text: approval.risk, tone: riskTone(approval.risk) },
]);
</script>

<div class="grid gap-2" aria-label="Tool approval">
  <ToolApprovalSummary {toolName} {presentation} {includeBody} />
  {#if approval.reason}
    <p class="m-0 text-sm text-muted-foreground">{approval.reason}</p>
  {/if}
  <ToolFooter {meta} {detailsAction}>
    {#snippet actions()}
      <Button
        size="sm"
        disabled={Boolean(decision)}
        onclick={() => void decide("approve")}
      >
        {#if decision === "approve"}
          <Spinner class="size-3.5" />Approving…
        {:else}
          <Check size={14} strokeWidth={2.4} />Approve
        {/if}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={Boolean(decision)}
        onclick={() => void decide("deny")}
      >
        {#if decision === "deny"}
          <Spinner class="size-3.5" />Denying…
        {:else}
          <X size={14} strokeWidth={2.4} />Deny
        {/if}
      </Button>
    {/snippet}
  </ToolFooter>
  {#if actionError}
    <p class="m-0 text-xs text-destructive" role="alert">{actionError}</p>
  {/if}
</div>
