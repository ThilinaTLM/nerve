<script lang="ts">
import type {
  ApprovalRequest,
  InteractionResolution,
} from "@nervekit/contracts/core";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import Check from "@lucide/svelte/icons/check";
import X from "@lucide/svelte/icons/x";
let {
  request,
  onResolve,
}: {
  request: ApprovalRequest;
  onResolve?: (resolution: InteractionResolution) => Promise<unknown>;
} = $props();
let pending = $state(false);
let error = $state<string>();
async function decide(
  decision: "approve" | "deny",
  persistScope?: "conversation" | "project" | "user",
) {
  if (pending) return;
  pending = true;
  error = undefined;
  try {
    await onResolve?.({ kind: "approval", decision, persistScope });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    pending = false;
  }
}
</script>
<p class="text-sm text-muted-foreground">{request.reason}</p>
{#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
<div class="flex justify-end gap-2 pt-2">
  <Button
    size="sm"
    variant="ghost"
    disabled={pending || !onResolve}
    onclick={() => decide("deny")}><X size={14} />Deny</Button
  >
  <DropdownMenu.Root
    ><div class="flex items-center gap-1">
      <Button
        size="sm"
        disabled={pending || !onResolve}
        onclick={() => decide("approve")}
        ><Check size={14} />Approve once</Button
      ><DropdownMenu.Trigger
        ><Button
          size="icon-sm"
          variant="ghost"
          disabled={pending}
          aria-label="Always allow options">⋯</Button
        ></DropdownMenu.Trigger
      >
    </div>
    <DropdownMenu.Content
      ><DropdownMenu.Item onclick={() => decide("approve", "conversation")}
        >Always allow in conversation</DropdownMenu.Item
      ><DropdownMenu.Item onclick={() => decide("approve", "project")}
        >Always allow in project</DropdownMenu.Item
      ><DropdownMenu.Item onclick={() => decide("approve", "user")}
        >Always allow for user</DropdownMenu.Item
      ></DropdownMenu.Content
    ></DropdownMenu.Root
  >
</div>
