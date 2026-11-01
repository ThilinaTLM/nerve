<script lang="ts">
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import FileText from "@lucide/svelte/icons/file-text";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";
import LoaderCircle from "@lucide/svelte/icons/loader-circle";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { cn } from "@nervekit/ui-kit/utils";
import { dropActionLabel, type DropPlan } from "../state/drop-to-open";
import { signalMeta } from "./directory-picker-helpers";
import ProjectIcon from "./ProjectIcon.svelte";

type Props = {
  open?: boolean;
  /** Undefined while the daemon is still classifying the dropped items. */
  plan?: DropPlan;
  pick?: number;
  busy?: boolean;
  error?: string;
  /** Formats a path for display (home collapsed to `~`). */
  displayPath: (path: string) => string;
  onConfirm: () => void;
  onCancel: () => void;
};

let {
  open = $bindable(false),
  plan,
  pick = $bindable(0),
  busy = false,
  error,
  displayPath,
  onConfirm,
  onCancel,
}: Props = $props();

const pickedRow = $derived(plan?.rows[pick]);
const action = $derived(dropActionLabel(pickedRow));
const canConfirm = $derived(
  Boolean(pickedRow?.selectable) && !busy && plan !== undefined,
);
const choosing = $derived(plan?.variant === "several");

function handleKeydown(event: KeyboardEvent) {
  if (!open || event.key !== "Enter" || event.isComposing) return;
  // Footer buttons keep native Enter. The header Close button receives
  // initial focus, so Enter there confirms; Escape remains the dismiss key.
  const target = event.target;
  if (target instanceof Element && target.closest(".dialog-footer")) return;
  event.preventDefault();
  if (canConfirm) onConfirm();
}

function handleOpenChange(next: boolean) {
  if (!next && !busy) onCancel();
}
</script>

<svelte:window onkeydowncapture={handleKeydown} />

<DialogShell
  {open}
  title={plan?.title ?? "Checking dropped items"}
  description={plan?.description ?? "Looking up what you dropped."}
  size="sm"
  closeLabel="Cancel"
  onOpenChange={handleOpenChange}
>
  {#if plan}
    <ul
      class="flex flex-col gap-1"
      role={choosing ? "radiogroup" : undefined}
      aria-label={choosing ? "Dropped folders" : "Dropped items"}
    >
      {#each plan.rows as row, index (row.path)}
        {@const selected = choosing && row.selectable && pick === index}
        <li>
          <svelte:element
            this={choosing && row.selectable ? "button" : "div"}
            type={choosing && row.selectable ? "button" : undefined}
            role={choosing && row.selectable ? "radio" : undefined}
            aria-checked={choosing && row.selectable ? selected : undefined}
            onclick={choosing && row.selectable
              ? () => (pick = index)
              : undefined}
            class={cn(
              "flex w-full items-center gap-2.5 rounded-md border bg-card px-2.5 py-2 text-left",
              choosing &&
                row.selectable &&
                "cursor-pointer hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              selected && "border-ring bg-selected hover:bg-selected",
              !row.selectable && "opacity-50",
            )}
          >
            {#if row.kind === "file"}
              <FileText
                class="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            {:else if row.projectId}
              <ProjectIcon projectId={row.projectId} class="size-5" />
            {:else}
              <Folder
                class="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            {/if}
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="flex items-center gap-1.5 text-ui">
                <span class="truncate">{row.name}</span>
                {#if !row.selectable}
                  <span class="text-ui text-muted-foreground">Skipped</span>
                {/if}
              </span>
              <span
                class="truncate font-mono text-ui text-muted-foreground"
                title={row.path}>{displayPath(row.path)}</span
              >
            </span>
            {#if row.signals.length}
              <span class="flex shrink-0 gap-1">
                {#each row.signals as signal (signal)}
                  {@const meta = signalMeta[signal]}
                  <Badge variant={meta.tone ?? "neutral"} title={meta.title}
                    >{meta.label}</Badge
                  >
                {/each}
              </span>
            {/if}
          </svelte:element>
        </li>
      {/each}
    </ul>
  {:else}
    <div
      class="flex items-center gap-2 text-ui text-muted-foreground"
      role="status"
    >
      <LoaderCircle class="size-4 animate-spin" aria-hidden="true" />
      Checking dropped items
    </div>
  {/if}
  {#if error}
    <p class="mt-2 text-ui text-destructive" role="alert">{error}</p>
  {/if}

  {#snippet footer()}
    <Button variant="ghost" onclick={onCancel} disabled={busy}>Cancel</Button>
    <Button onclick={onConfirm} disabled={!canConfirm}>
      {#if busy}
        <LoaderCircle class="animate-spin" />
      {:else if pickedRow?.projectId}
        <ArrowRight />
      {:else}
        <FolderOpen />
      {/if}
      {action}
    </Button>
  {/snippet}
</DialogShell>
