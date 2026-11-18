<!--
  The strip above a file whose type extensions can preview: switches between Nerve's own view
  and each matching extension preview, and offers the edit control the selected preview's
  `edit` mode allows (`source`: Nerve's editor; `custom`: the preview's own editor; `none`: none).
-->
<script lang="ts">
import Pencil from "@lucide/svelte/icons/pencil";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as ToggleGroup from "@nervekit/ui-kit/components/ui/toggle-group";
import {
  defaultPreviewChoice,
  previewKey,
  type ExtensionPreview,
} from "../model/preview-selection";

let {
  previews,
  selected,
  mode,
  onSelect,
  onModeChange,
  onEditSource,
}: {
  previews: ExtensionPreview[];
  /** The selected preview; `undefined` is Nerve's own view. */
  selected?: ExtensionPreview;
  mode: "preview" | "edit";
  onSelect: (choice: string) => void;
  onModeChange: (mode: "preview" | "edit") => void;
  onEditSource: () => void;
} = $props();

const value = $derived(selected ? previewKey(selected) : defaultPreviewChoice);
</script>

<div
  class="flex min-w-0 flex-none flex-wrap items-center gap-2 border-b border-border-subtle bg-panel px-3 py-1.5"
>
  <ToggleGroup.Root
    type="single"
    variant="chip"
    size="sm"
    {value}
    aria-label="File view"
    onValueChange={(next) => {
      if (next) onSelect(next);
    }}
  >
    <ToggleGroup.Item value={defaultPreviewChoice}>Default</ToggleGroup.Item>
    {#each previews as preview (previewKey(preview))}
      <ToggleGroup.Item
        value={previewKey(preview)}
        title={`${preview.label} · ${preview.extensionName}`}
        >{preview.label}</ToggleGroup.Item
      >
    {/each}
  </ToggleGroup.Root>
  {#if selected?.edit === "custom"}
    <ToggleGroup.Root
      type="single"
      variant="chip"
      size="sm"
      value={mode}
      aria-label="Preview mode"
      onValueChange={(next) => {
        if (next === "preview" || next === "edit") onModeChange(next);
      }}
    >
      <ToggleGroup.Item value="preview">Preview</ToggleGroup.Item>
      <ToggleGroup.Item value="edit">Edit</ToggleGroup.Item>
    </ToggleGroup.Root>
  {:else if selected?.edit === "source"}
    <Button variant="ghost" size="sm" onclick={onEditSource}>
      <Pencil />
      Edit source
    </Button>
  {/if}
</div>
