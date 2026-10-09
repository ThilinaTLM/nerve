<script lang="ts">
import Markdown from "@nervekit/ui-kit/renderers/markdown/Markdown.svelte";
import type { ToolView } from "../views/tool-result-view";
import type {
  PlanReviewRequest,
  InteractionResolution,
} from "@nervekit/contracts/core";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";
let {
  request,
  onResolve,
  onOpenFile,
  onReadFile,
  view,
}: {
  view?: Extract<ToolView, { kind: "plan_mode" }>;
  onReadFile?: (path: string) => Promise<string>;
  request?: PlanReviewRequest;
  onOpenFile?: (path: string) => void;
  onResolve?: (resolution: InteractionResolution) => Promise<unknown>;
} = $props();
let content = $state("");
$effect(() => {
  content = view?.planPreview ?? view?.summary ?? "";
  if (!request || !onReadFile) return;
  let current = true;
  void onReadFile(request.path)
    .then((text) => {
      if (current) content = text;
    })
    .catch((e) => {
      if (current) error = String(e);
    });
  return () => {
    current = false;
  };
});
let feedback = $state("");
let pending = $state(false);
let error = $state<string>();
async function decide(decision: "approve" | "reject") {
  pending = true;
  error = undefined;
  try {
    await onResolve?.({
      kind: "plan_review",
      decision,
      feedback: feedback || undefined,
    });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    pending = false;
  }
}
</script>
{#if content}<div class="rounded-md bg-well p-3">
    <Markdown text={content} />
  </div>{/if}
{#if request}<p class="text-sm text-muted-foreground">
    Review plan: <Button
      variant="ghost"
      size="xs"
      class="font-mono"
      onclick={() => onOpenFile?.(request!.path)}>{request.path}</Button
    >
  </p>
  <Textarea
    bind:value={feedback}
    placeholder="Feedback (optional)"
    aria-label="Plan feedback"
  />
  <div class="flex justify-end gap-2 pt-2">
    <Button
      variant="ghost"
      size="sm"
      disabled={pending || !onResolve}
      onclick={() => decide("reject")}>Request changes</Button
    ><Button
      size="sm"
      disabled={pending || !onResolve}
      onclick={() => decide("approve")}>Accept plan</Button
    >
  </div>{/if}
{#if error}<p class="text-xs text-destructive" role="alert">{error}</p>{/if}
