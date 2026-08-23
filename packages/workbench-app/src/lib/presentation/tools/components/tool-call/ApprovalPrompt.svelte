<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import X from "@lucide/svelte/icons/x";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { SplitButton } from "@nervekit/ui-kit/components/ui/split-button";
import type { ApprovalWithToolCall } from "../../../state/tool-types";
import type { ToolArgumentPresentation } from "../../lifecycle/registry";
import type { MetaItem, MetaTone } from "../../views/tool-presentation";
import ToolFooter from "./ToolFooter.svelte";

type Props = {
  approval: ApprovalWithToolCall;
  toolName: string;
  presentation: ToolArgumentPresentation;
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
  presentation,
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

function exceptionLabel(
  exception: ApprovalWithToolCall["suggestedExceptions"][number],
): string {
  const selector = exception.selector;
  if (selector.kind === "tool") return selector.toolName;
  if (selector.kind === "command_prefix") return selector.tokens.join(" ");
  return selector.pattern;
}

const meta = $derived<MetaItem[]>([
  ...presentation.secondary,
  { text: approval.risk, tone: riskTone(approval.risk) },
]);
const canPersistProject = $derived(
  approval.offeredScopes.includes("always_project") &&
    approval.suggestedExceptions.length > 0,
);
const canPersistGlobal = $derived(
  approval.offeredScopes.includes("always_global") &&
    approval.suggestedExceptions.length > 0,
);
const hasPersistentChoice = $derived(canPersistProject || canPersistGlobal);
const reviewedTarget = $derived(
  approval.suggestedExceptions.map(exceptionLabel).join(", "),
);
</script>

<div class="grid gap-2" aria-label="Tool approval">
  <ToolFooter {meta} {detailsAction}>
    {#snippet actions()}
      {#if hasPersistentChoice}
        <SplitButton
          size="sm"
          disabled={Boolean(decision)}
          menuAlign="end"
          menuClass="w-56"
          triggerLabel="Approval options"
          onclick={() => void decide("approve")}
        >
          {#if decision === "approve"}
            <Spinner class="size-3.5" />Approving…
          {:else}
            <Check class="size-3.5" strokeWidth={2.4} />Approve
          {/if}
          {#snippet menu()}
            <DropdownMenu.Item
              disabled={Boolean(decision)}
              onSelect={() => void decide("approve")}
            >
              Approve once
            </DropdownMenu.Item>
            {#if canPersistProject}
              <DropdownMenu.Item
                disabled={Boolean(decision)}
                title={`Always approve ${reviewedTarget} in this project`}
                onSelect={() => void decide("always_project")}
              >
                Always approve in project
              </DropdownMenu.Item>
            {/if}
            {#if canPersistGlobal}
              <DropdownMenu.Item
                disabled={Boolean(decision)}
                title={`Always approve ${reviewedTarget} globally`}
                onSelect={() => void decide("always_global")}
              >
                Always approve globally
              </DropdownMenu.Item>
            {/if}
          {/snippet}
        </SplitButton>
      {:else}
        <Button
          size="sm"
          disabled={Boolean(decision)}
          onclick={() => void decide("approve")}
        >
          {#if decision === "approve"}
            <Spinner class="size-3.5" />Approving…
          {:else}
            <Check class="size-3.5" strokeWidth={2.4} />Approve
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
          <X class="size-3.5" strokeWidth={2.4} />Deny
        {/if}
      </Button>
    {/snippet}
  </ToolFooter>
  {#if actionError}
    <p class="m-0 text-xs text-destructive" role="alert">{actionError}</p>
  {/if}
</div>
