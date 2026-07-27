<script lang="ts">
import Download from "@lucide/svelte/icons/download";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { PanelPropertyRow, PanelSection } from "@nervekit/workbench-ui/panel";
import type { ConversationRecord } from "$lib/api";
import { panelSectionPreferences } from "$lib/app/shell/panel-section-preferences.svelte";

let {
  activeConversation,
  exportUrl,
  systemPromptUrl,
}: {
  activeConversation?: ConversationRecord;
  exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
  systemPromptUrl?: () => string | undefined;
} = $props();

const open = $derived(panelSectionPreferences.isOpen("context.export"));
const systemPromptHref = $derived(systemPromptUrl?.());
</script>

<PanelSection
  title="Export"
  icon={Download}
  {open}
  onOpenChange={(next) =>
    panelSectionPreferences.setOpen("context.export", next)}
>
  {#if activeConversation}
    <PanelPropertyRow label="Conversation">
      <div class="flex flex-wrap gap-1.5 py-1">
        <Badge
          href={exportUrl?.("json")}
          download={`conversation-${activeConversation.id}.json`}
          variant="outline"
          size="sm">JSON</Badge
        >
        <Badge
          href={exportUrl?.("md")}
          download={`conversation-${activeConversation.id}.md`}
          variant="outline"
          size="sm">Markdown</Badge
        >
        <Badge
          href={exportUrl?.("html")}
          download={`conversation-${activeConversation.id}.html`}
          variant="outline"
          size="sm">HTML</Badge
        >
      </div>
    </PanelPropertyRow>
    <PanelPropertyRow label="System prompt">
      {#if systemPromptHref}
        <a
          class="inline-flex w-fit items-center gap-1.5 py-1 text-xs font-medium text-foreground hover:underline"
          href={systemPromptHref}
          download
        >
          <ScrollText size={13} strokeWidth={2.2} />Export system prompt
        </a>
      {:else}
        <span class="text-muted-foreground">No active agent.</span>
      {/if}
    </PanelPropertyRow>
  {:else}
    <p class="px-2 py-1 text-xs text-muted-foreground">
      No active conversation to export.
    </p>
  {/if}
</PanelSection>
