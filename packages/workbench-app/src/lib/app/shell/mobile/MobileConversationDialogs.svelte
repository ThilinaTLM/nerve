<script lang="ts">
import AlertDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import {
  deleteConversationAndRefresh,
  maintenance,
} from "$lib/application/workspace";
import {
  RenameConversationDialog,
  updateConversationStateAndRefresh,
} from "$lib/features/projects";
import {
  mobileConversationDelete,
  mobileConversationRename,
} from "./mobile-conversation-menu.svelte";

/** Dialogs for conversation actions taken from phone lists. */
const target = $derived(mobileConversationDelete.target);
const renameTarget = $derived(mobileConversationRename.target);
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

{#if renameTarget}
  {@const rename = renameTarget}
  {#key rename}
    <RenameConversationDialog
      open
      title={rename.title}
      onRename={(title) =>
        void updateConversationStateAndRefresh(rename.id, { title })}
      onOpenChange={(open) => {
        if (!open && mobileConversationRename.target === rename)
          mobileConversationRename.target = undefined;
      }}
    />
  {/key}
{/if}
