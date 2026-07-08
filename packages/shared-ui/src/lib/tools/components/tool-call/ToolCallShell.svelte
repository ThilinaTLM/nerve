<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ToolCallDisplayRecord } from "../../views/tool-result-view";
  import type { ToolPresentation } from "../../views/tool-presentation";
  import { trimTextPreview } from "@nervekit/shared-ui/core/utils/text-preview";
  import CardShell from "./CardShell.svelte";

  type Props = {
    toolCall: ToolCallDisplayRecord;
    presentation: ToolPresentation;
    bodyMode?: "output" | "interactive";
    onOpenDetails?: () => void;
    onOpenFile?: (path: string, line?: number) => void;
    children?: Snippet;
  };
  let {
    toolCall,
    presentation,
    bodyMode = "output",
    onOpenDetails,
    onOpenFile,
    children,
  }: Props = $props();

  const detailsAction = $derived(
    onOpenDetails
      ? { label: presentation.detailsAction?.label ?? "Details", onClick: onOpenDetails }
      : undefined,
  );
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
  footer={bodyMode !== "interactive"}
  {detailsAction}
  {onOpenFile}
>
  {#if children}{@render children()}{/if}
</CardShell>
