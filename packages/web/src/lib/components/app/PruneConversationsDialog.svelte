<script lang="ts">
  import type { PruneProjectConversationsRequest } from "../../api";
  import { Button } from "$lib/components/ui/button";
  import Dialog from "$lib/components/ui/dialog-shell";
  import RadioGroupField, {
    type RadioItem,
  } from "$lib/components/ui/radio-group-field";
  import SelectField, {
    type SelectItem,
  } from "$lib/components/ui/select-field";

  type Props = {
    open?: boolean;
    projectLabel?: string;
    totalCount?: number;
    ageEligible?: (days: number) => number;
    keepEligible?: (keep: number) => number;
    onConfirm?: (request: PruneProjectConversationsRequest) => void;
    onOpenChange?: (open: boolean) => void;
  };

  let {
    open = $bindable(false),
    projectLabel = "",
    totalCount = 0,
    ageEligible = () => 0,
    keepEligible = () => 0,
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

  let strategy = $state<"olderThanDays" | "keepLatest">("olderThanDays");
  let olderThanDays = $state("7");
  let keepLatest = $state("20");

  const removeCount = $derived(
    strategy === "olderThanDays"
      ? ageEligible(Number(olderThanDays))
      : keepEligible(Number(keepLatest)),
  );

  function buildRequest(): PruneProjectConversationsRequest {
    return strategy === "olderThanDays"
      ? { strategy: "olderThanDays", olderThanDays: Number(olderThanDays) }
      : { strategy: "keepLatest", keepLatest: Number(keepLatest) };
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
  class="prune-dialog"
  onOpenChange={handleOpenChange}
>
  <div class="prune-body">
    <RadioGroupField
      items={strategyItems}
      bind:value={strategy}
      ariaLabel="Cleanup strategy"
    />

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

    <p class="prune-summary">
      Removes up to <strong>{removeCount}</strong> of {totalCount} conversation{totalCount ===
      1
        ? ""
        : "s"}. Active conversations and processes are skipped.
    </p>
  </div>

  {#snippet footer()}
    <Button variant="ghost" onclick={() => handleOpenChange(false)}>Cancel</Button>
    <Button variant="destructive" onclick={handleConfirm} disabled={removeCount === 0}>
      Clean up
    </Button>
  {/snippet}
</Dialog>

<style>
  :global(.prune-dialog) {
    width: min(420px, calc(100vw - 32px));
  }

  .prune-body {
    display: grid;
    gap: 1rem;
    padding: 1rem 1.1rem;
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
