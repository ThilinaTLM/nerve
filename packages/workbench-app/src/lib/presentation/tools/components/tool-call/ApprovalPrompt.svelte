<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import X from "@lucide/svelte/icons/x";
import ShieldCheck from "@lucide/svelte/icons/shield-check";
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
  onGrantApproval?: (
    id: string,
    scope?: "single_call" | "always_project" | "always_global",
  ) => void | Promise<void>;
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

let decision = $state<
  "approve" | "always_project" | "always_global" | "deny" | undefined
>();
let actionError = $state<string | undefined>();

async function decide(
  kind: "approve" | "always_project" | "always_global" | "deny",
) {
  // One shared in-flight state covers every choice and rejects duplicates.
  if (decision) return;
  const callback = kind === "deny" ? onDenyApproval : onGrantApproval;
  if (!callback) return;
  decision = kind;
  actionError = undefined;
  try {
    if (kind === "deny") await callback(approval.id);
    else await callback(approval.id, kind === "approve" ? "single_call" : kind);
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
      {#if approval.offeredScopes.includes("always_project") && approval.suggestedGrants.length > 0}
        <Button
          size="sm"
          variant="secondary"
          disabled={Boolean(decision)}
          title={approval.suggestedGrants
            .map((grant) =>
              grant.target === "tool" ? grant.toolName : grant.tokens.join(" "),
            )
            .join(", ")}
          onclick={() => void decide("always_project")}
        >
          {#if decision === "always_project"}
            <Spinner class="size-3.5" />Saving…
          {:else}
            <ShieldCheck class="size-3.5" />Always in project
          {/if}
        </Button>
      {/if}
      {#if approval.offeredScopes.includes("always_global") && approval.suggestedGrants.length > 0}
        <Button
          size="sm"
          variant="ghost"
          disabled={Boolean(decision)}
          onclick={() => void decide("always_global")}
        >
          {#if decision === "always_global"}
            <Spinner class="size-3.5" />Saving…
          {:else}
            Always globally
          {/if}
        </Button>
      {/if}
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
