<script lang="ts">
import type { PruneProjectConversationsRequest } from "$lib/api";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import RadioGroupField, {
  type RadioItem,
} from "@nervekit/ui-kit/components/composites/radio-group-field";
import SelectField, {
  type SelectItem,
} from "@nervekit/ui-kit/components/composites/select-field";

type Props = {
  open?: boolean;
  projectLabel?: string;
  totalCount?: number;
  ageEligible?: (days: number) => number;
  keepEligible?: (keep: number) => number;
  completedEligible?: () => number;
  onConfirm?: (request: PruneProjectConversationsRequest) => void;
  onOpenChange?: (open: boolean) => void;
};

let {
  open = $bindable(false),
  projectLabel = "",
  totalCount = 0,
  ageEligible = () => 0,
  keepEligible = () => 0,
  completedEligible = () => 0,
  onConfirm,
  onOpenChange,
}: Props = $props();

const strategyItems: RadioItem[] = [
  {
    value: "olderThanDays",
    label: "By age",
    detail: "Remove conversations not updated within the selected window.",
  },
  {
    value: "keepLatest",
    label: "By count",
    detail: "Keep the most recent conversations and remove the rest.",
  },
  {
    value: "completed",
    label: "Completed",
    detail: "Remove all conversations marked done.",
  },
];

const ageItems: SelectItem[] = [
  { value: "1", label: "Older than 1 day" },
  { value: "2", label: "Older than 2 days" },
  { value: "3", label: "Older than 3 days" },
  { value: "7", label: "Older than 7 days" },
  { value: "14", label: "Older than 14 days" },
  { value: "30", label: "Older than 30 days" },
  { value: "90", label: "Older than 90 days" },
];

const keepItems: SelectItem[] = [
  { value: "5", label: "Keep the latest 5" },
  { value: "10", label: "Keep the latest 10" },
  { value: "20", label: "Keep the latest 20" },
  { value: "50", label: "Keep the latest 50" },
  { value: "100", label: "Keep the latest 100" },
];

let strategy = $state<"olderThanDays" | "keepLatest" | "completed">(
  "olderThanDays",
);
let olderThanDays = $state("7");
let keepLatest = $state("20");

const removeCount = $derived(
  strategy === "olderThanDays"
    ? ageEligible(Number(olderThanDays))
    : strategy === "keepLatest"
      ? keepEligible(Number(keepLatest))
      : completedEligible(),
);

function buildRequest(): PruneProjectConversationsRequest {
  if (strategy === "olderThanDays") {
    return { strategy: "olderThanDays", olderThanDays: Number(olderThanDays) };
  }
  if (strategy === "keepLatest") {
    return { strategy: "keepLatest", keepLatest: Number(keepLatest) };
  }
  return { strategy: "completed" };
}

function handleConfirm() {
  onConfirm?.(buildRequest());
  open = false;
  onOpenChange?.(false);
}

function handleOpenChange(next: boolean) {
  open = next;
  onOpenChange?.(next);
}
</script>

<Dialog
  bind:open
  title="Clean up conversations"
  description={projectLabel
    ? `Choose how to clean up conversations in “${projectLabel}”.`
    : "Choose how to clean up conversations."}
  size="sm"
  onOpenChange={handleOpenChange}
>
  <div class="prune-body">
    <RadioGroupField
      items={strategyItems}
      bind:value={strategy}
      ariaLabel="Cleanup strategy"
    />

    {#if strategy !== "completed"}
      <div class="prune-control">
        {#if strategy === "olderThanDays"}
          <SelectField
            items={ageItems}
            bind:value={olderThanDays}
            ariaLabel="Age window"
          />
        {:else}
          <SelectField
            items={keepItems}
            bind:value={keepLatest}
            ariaLabel="Conversations to keep"
          />
        {/if}
      </div>
    {/if}

    <p class="prune-summary">
      Removes up to <strong>{removeCount}</strong> of {totalCount} conversation{totalCount ===
      1
        ? ""
        : "s"}. Active conversations and tasks are skipped.
    </p>
  </div>

  {#snippet footer()}
    <Button size="sm" variant="ghost" onclick={() => handleOpenChange(false)}
      >Cancel</Button
    >
    <Button
      size="sm"
      variant="destructive"
      onclick={handleConfirm}
      disabled={removeCount === 0}
    >
      Clean up
    </Button>
  {/snippet}
</Dialog>

<style>
.prune-body {
  display: grid;
  gap: 1rem;
}

.prune-control {
  display: grid;
  max-width: 18rem;
}

.prune-summary {
  margin: 0;
  color: var(--muted-foreground);
  font-size: var(--text-sm);
}

.prune-summary strong {
  color: var(--foreground);
  font-weight: 600;
}
</style>
