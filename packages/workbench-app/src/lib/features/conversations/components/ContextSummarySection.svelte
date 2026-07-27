<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import Layers from "@lucide/svelte/icons/layers";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import {
  PanelPropertyRow,
  PanelSection,
  PanelToolbarButton,
} from "@nervekit/workbench-ui/panel";
import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  StatusResponse,
} from "$lib/api";
import { writeClipboardText } from "$lib/core/clipboard";
import { notify } from "$lib/features/notifications/notify.svelte";
import { panelSectionPreferences } from "$lib/app/shell/panel-section-preferences.svelte";

let {
  status,
  activeProject,
  activeConversation,
  activeAgent,
  compacting = false,
  onRequestCompact,
}: {
  status?: StatusResponse;
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
  activeAgent?: AgentRecord;
  compacting?: boolean;
  onRequestCompact?: () => void;
} = $props();

const open = $derived(panelSectionPreferences.isOpen("context.active"));

const fields = $derived([
  { label: "Project", value: activeProject?.name },
  { label: "Directory", value: activeProject?.dir },
  { label: "Conversation", value: activeConversation?.id },
  { label: "Agent", value: activeAgent?.id },
  { label: "Daemon", value: status?.daemonId },
  { label: "Data", value: status?.dataDir },
]);
const contextText = $derived(
  fields.map((field) => `${field.label}: ${field.value ?? "—"}`).join("\n"),
);

async function copyContext(): Promise<void> {
  try {
    await writeClipboardText(contextText);
    notify.success("Copied active context");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}
</script>

<PanelSection
  title="Active Context"
  icon={Layers}
  {open}
  onOpenChange={(next) =>
    panelSectionPreferences.setOpen("context.active", next)}
>
  {#snippet actions()}
    <PanelToolbarButton
      icon={Copy}
      label="Copy active context"
      onclick={() => void copyContext()}
    />
  {/snippet}

  {#each fields as field (field.label)}
    <PanelPropertyRow
      label={field.label}
      value={field.value}
      title={field.value}
      mono
    />
  {/each}
  <div class="px-2 pt-1.5">
    <Button
      size="xs"
      variant="outline"
      disabled={!activeConversation || compacting}
      title={activeConversation
        ? compacting
          ? "Conversation compaction is in progress"
          : "Summarize earlier messages to reduce context usage"
        : "Select a conversation to compact its context"}
      onclick={() => onRequestCompact?.()}
    >
      <FoldVertical />
      {compacting ? "Compacting…" : "Compact context"}
    </Button>
  </div>
</PanelSection>
