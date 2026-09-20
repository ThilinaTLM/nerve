<script lang="ts">
import AlertDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import {
  deleteConversationAndRefresh,
  maintenance,
} from "$lib/application/workspace";
import { mobileConversationDelete } from "./mobile-conversation-menu.svelte";

/** Confirmation for destructive conversation actions taken from phone lists. */
const target = $derived(mobileConversationDelete.target);
</script>

<AlertDialog
  open={Boolean(target)}
  title="Delete conversation?"
  description={target
    ? `“${target.label}” and its history are removed from Nerve. Files on disk are not deleted.`
    : ""}
  confirmLabel="Delete"
  destructive
  onConfirm={() => {
    if (target && !maintenance.active)
      void deleteConversationAndRefresh(target.id);
  }}
  onOpenChange={(open) => {
    if (!open) mobileConversationDelete.target = undefined;
  }}
/>
