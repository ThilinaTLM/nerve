<script lang="ts">
import Download from "@lucide/svelte/icons/download";
import FileCode from "@lucide/svelte/icons/file-code";
import FileJson from "@lucide/svelte/icons/file-json";
import FileText from "@lucide/svelte/icons/file-text";
import ScrollText from "@lucide/svelte/icons/scroll-text";
import type { Component } from "svelte";
import { buttonVariants } from "@nervekit/ui-kit/components/ui/button";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
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

type ExportEntry = {
  id: string;
  label: string;
  icon: Component;
  href?: string;
  filename?: string;
};

const entries = $derived.by<ExportEntry[]>(() => {
  if (!activeConversation) return [];
  const id = activeConversation.id;
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
      href: systemPromptUrl?.(),
    },
  ];
});

function download(entry: ExportEntry): void {
  if (!entry.href) return;
  const anchor = document.createElement("a");
  anchor.href = entry.href;
  // An empty value still marks this as a download before desktop navigation guards run.
  anchor.download = entry.filename ?? "";
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={buttonVariants({ variant: "ghost", size: "icon-xs" })}
    aria-label="Export conversation"
    title="Export conversation"
    disabled={!activeConversation}
  >
    <Download class="size-4" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end" class="w-48">
    {#each entries as entry (entry.id)}
      {@const Icon = entry.icon}
      <DropdownMenu.Item
        disabled={!entry.href}
        onSelect={() => download(entry)}
      >
        <Icon />
        <span>{entry.label}</span>
      </DropdownMenu.Item>
    {/each}
  </DropdownMenu.Content>
</DropdownMenu.Root>
