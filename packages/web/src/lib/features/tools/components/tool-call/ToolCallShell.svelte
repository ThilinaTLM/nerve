<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ToolCallRecord } from "$lib/api";
  import type { ToolPresentation } from "$lib/features/tools/views/tool-presentation";
  import { trimTextPreview } from "$lib/core/utils/text-preview";
  import CardShell from "./CardShell.svelte";

  type Props = {
    toolCall: ToolCallRecord;
    presentation: ToolPresentation;
    bodyMode?: "output" | "interactive";
    expanded?: boolean;
    onOpenFile?: (path: string, line?: number) => void;
    children?: Snippet;
  };
  let {
    toolCall,
    presentation,
    bodyMode = "output",
    expanded = $bindable(false),
    onOpenFile,
    children,
  }: Props = $props();

  const collapse = $derived(bodyMode === "output" ? presentation.collapse : undefined);
  const errorPreview = $derived(
    toolCall.error
      ? trimTextPreview(toolCall.error, { headLines: 18, tailLines: 6, maxChars: 6_000 }).text
      : undefined,
  );
</script>

<CardShell
  status={toolCall.status}
  dotTone={presentation.dotTone}
  dotPulse={presentation.dotPulse}
  badge={presentation.badge}
  arg={presentation.primaryArg}
  error={errorPreview}
  meta={presentation.meta}
  collapse={collapse
    ? { expandLabel: collapse.expandLabel, collapseLabel: collapse.collapseLabel }
    : undefined}
  {onOpenFile}
  bind:expanded
>
  {#if children}{@render children()}{/if}
</CardShell>
