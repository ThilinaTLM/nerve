<script lang="ts">
import Copy from "@lucide/svelte/icons/copy";
import FoldVertical from "@lucide/svelte/icons/fold-vertical";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/ui/confirm-dialog";
import {
  PanelBanner,
  PanelHeader,
  PanelToolbarButton,
  PanelView,
} from "$lib/presentation/panel";
import type { ContextUsage } from "@nervekit/contracts";
import type {
  AgentRecord,
  ConversationRecord,
  ProjectRecord,
  StatusResponse,
} from "$lib/api";
import { writeClipboardText } from "$lib/core/clipboard";
import { notify } from "$lib/features/notifications/notify.svelte";
import type { ConversationUsageSummary } from "$lib/presentation/usage/conversation-usage";
import ContextAgentsTree from "./ContextAgentsTree.svelte";
import ContextConversationUsage from "./ContextConversationUsage.svelte";
import ContextExportMenu from "./ContextExportMenu.svelte";
import ContextSessionSection from "./ContextSessionSection.svelte";
import ContextUsageStrip from "./ContextUsageStrip.svelte";
import { sessionFields, sessionFieldsText } from "./context-session-fields";

type Props = {
  status?: StatusResponse;
  contextUsage?: ContextUsage;
  conversationUsage: ConversationUsageSummary;
  contextWindow?: number;
  activeProject?: ProjectRecord;
  activeConversation?: ConversationRecord;
  activeAgent?: AgentRecord;
  conversationAgents?: AgentRecord[];
  compacting?: boolean;
  exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
  systemPromptUrl?: () => string | undefined;
  onSelectAgent?: (agent: AgentRecord) => void;
  onCompact?: () => void;
};

let {
  status,
  contextUsage,
  conversationUsage,
  contextWindow = 0,
  activeProject,
  activeConversation,
  activeAgent,
  conversationAgents = [],
  compacting = false,
  exportUrl,
  systemPromptUrl,
  onSelectAgent,
  onCompact,
}: Props = $props();

let confirmCompactOpen = $state(false);

const fields = $derived(
  sessionFields({ status, activeProject, activeConversation }),
);

const compactTitle = $derived(
  activeConversation
    ? compacting
      ? "Conversation compaction is in progress"
      : "Summarize earlier messages to reduce context usage"
    : "Select a conversation to compact its context",
);

async function copySession(): Promise<void> {
  try {
    await writeClipboardText(sessionFieldsText(fields));
    notify.success("Copied session details");
  } catch {
    notify.error("Could not copy to clipboard");
  }
}
</script>

<PanelView padded={false}>
  {#snippet banner()}
    <PanelHeader title="Context">
      {#snippet trailing()}
        <PanelToolbarButton
          icon={Copy}
          label="Copy session details"
          disabled={!activeProject}
          onclick={() => void copySession()}
        />
        <ContextExportMenu {activeConversation} {exportUrl} {systemPromptUrl} />
      {/snippet}
    </PanelHeader>
    {#if !activeProject}
      <PanelBanner tone="muted">Select a project to view context.</PanelBanner>
    {/if}
  {/snippet}

  {#if activeProject}
    <div class="flex flex-col gap-4 py-1">
      <ContextUsageStrip {contextUsage} {contextWindow}>
        <Button
          size="xs"
          variant="outline"
          class="rounded-full"
          title={compactTitle}
          disabled={!activeConversation || compacting}
          onclick={() => (confirmCompactOpen = true)}
        >
          <FoldVertical />
          {compacting ? "Compacting…" : "Compact"}
        </Button>
      </ContextUsageStrip>
      <ContextConversationUsage {conversationUsage} />
      <div class="flex min-w-0 flex-col">
        <ContextSessionSection {fields} />
      </div>
      <ContextAgentsTree {conversationAgents} {activeAgent} {onSelectAgent} />
    </div>
  {/if}
</PanelView>

<ConfirmDialog
  bind:open={confirmCompactOpen}
  title="Compact conversation"
  description="This summarizes earlier messages to reduce context size. The full history stays available in the branch tree."
  confirmLabel="Compact context"
  onConfirm={() => onCompact?.()}
/>
