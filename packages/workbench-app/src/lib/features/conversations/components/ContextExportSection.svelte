<script lang="ts">
import Download from "@lucide/svelte/icons/download";
import FileCode from "@lucide/svelte/icons/file-code";
import FileJson from "@lucide/svelte/icons/file-json";
import FileText from "@lucide/svelte/icons/file-text";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import type { Component } from "svelte";
import {
  PanelEmpty,
  PanelList,
  PanelRow,
  PanelSectionHeader,
  PanelToolbarButton,
} from "@nervekit/workbench-ui/panel";
import type { ConversationRecord } from "$lib/api";

let {
  activeConversation,
  exportUrl,
  systemPromptUrl,
}: {
  activeConversation?: ConversationRecord;
  exportUrl?: (kind: "json" | "md" | "html") => string | undefined;
  systemPromptUrl?: () => string | undefined;
} = $props();

type ExportRow = {
  id: string;
  label: string;
  icon: Component;
  href?: string;
  filename?: string;
  description?: string;
};

const rows = $derived.by<ExportRow[]>(() => {
  if (!activeConversation) return [];
  const id = activeConversation.id;
  const systemPromptHref = systemPromptUrl?.();
  return [
    {
      id: "json",
      label: "JSON",
      icon: FileJson,
      href: exportUrl?.("json"),
      filename: `conversation-${id}.json`,
    },
    {
      id: "md",
      label: "Markdown",
      icon: FileText,
      href: exportUrl?.("md"),
      filename: `conversation-${id}.md`,
    },
    {
      id: "html",
      label: "HTML",
      icon: FileCode,
      href: exportUrl?.("html"),
      filename: `conversation-${id}.html`,
    },
    {
      id: "system-prompt",
      label: "System prompt",
      icon: ScrollText,
      href: systemPromptHref,
      description: systemPromptHref ? undefined : "No active agent",
    },
  ];
});

function download(row: ExportRow): void {
  if (!row.href) return;
  const anchor = document.createElement("a");
  anchor.href = row.href;
  if (row.filename) anchor.download = row.filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
</script>

<section class="flex min-w-0 flex-col">
  <PanelSectionHeader title="Export" icon={Download} />

  <div class="flex min-w-0 flex-col pb-1">
    {#if activeConversation}
      <PanelList ariaLabel="Conversation exports">
        {#each rows as row (row.id)}
          <PanelRow
            icon={row.icon}
            label={row.label}
            description={row.description}
            disabled={!row.href}
            alwaysShowActions
            onclick={() => download(row)}
          >
            {#snippet actions()}
              <PanelToolbarButton
                icon={Download}
                label={`Download ${row.label}`}
                href={row.href}
                download={row.filename}
                disabled={!row.href}
              />
            {/snippet}
          </PanelRow>
        {/each}
      </PanelList>
    {:else}
      <PanelEmpty
        icon={Download}
        title="Nothing to export"
        description="Open a conversation to export its transcript."
      />
    {/if}
  </div>
</section>
