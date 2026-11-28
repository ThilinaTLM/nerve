<script lang="ts">
import type { PreviewToolDefinition } from "@nervekit/contracts/core";
import { notifyCopyResult } from "@nervekit/ui-kit/browser/notifications";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import { CodeView } from "$lib/presentation/code";
import {
  toolDefinitionsMarkdown,
  type RequestPreviewSection,
} from "./request-preview";

let {
  text,
  tools,
  section,
  onSectionChange,
}: {
  text: string;
  /** Absent when the preview was unavailable; `text` then explains why. */
  tools?: readonly PreviewToolDefinition[];
  section: RequestPreviewSection;
  onSectionChange: (section: RequestPreviewSection) => void;
} = $props();

const toolsText = $derived(tools ? toolDefinitionsMarkdown(tools) : text);
const label = $derived(
  section === "tools"
    ? "Tool definitions for the next request"
    : "System prompt for the next request",
);
</script>

<section class="flex h-full min-h-0 min-w-0 flex-col bg-background">
  <div
    class="flex items-center gap-3 border-b border-border-subtle px-4 py-1.5"
  >
    <ToggleGroup.Root
      type="single"
      variant="outline"
      size="sm"
      value={section}
      aria-label="Next request content"
      onValueChange={(value) => {
        if (value === "system-prompt" || value === "tools")
          onSectionChange(value);
      }}
    >
      <ToggleGroup.Item value="system-prompt">System prompt</ToggleGroup.Item>
      <ToggleGroup.Item value="tools"
        >Tools{tools ? ` (${tools.length})` : ""}</ToggleGroup.Item
      >
    </ToggleGroup.Root>
    <p class="m-0 min-w-0 truncate text-ui text-muted-foreground">
      Snapshot from when this pane was opened.
    </p>
  </div>
  {#key section}
    <CodeView
      class="min-h-0 flex-1"
      text={section === "tools" ? toolsText : text}
      language="markdown"
      wrap={true}
      ariaLabel={label}
      onCopy={(ok) => notifyCopyResult(ok, "selection")}
    />
  {/key}
</section>
