<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import GitMerge from "@lucide/svelte/icons/git-merge";
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { GithubPrDetail, GithubPrMergeMethod } from "@nervekit/contracts";
import { Badge } from "@nervekit/ui-kit/components/ui/badge";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import * as Dialog from "@nervekit/ui-kit/components/ui/dialog";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { SplitButton } from "@nervekit/ui-kit/components/ui/split-button";
import {
  defaultMergeMethod,
  mergeMethodLabel,
  mergeReadiness,
} from "./pr-pane-helpers";

type Props = {
  detail: GithubPrDetail;
  selectedMethod?: GithubPrMergeMethod;
  merging: boolean;
  error?: string;
  onMethodChange?: (method: GithubPrMergeMethod) => void;
  onMerge?: (method: GithubPrMergeMethod) => void;
};

let { detail, selectedMethod, merging, error, onMethodChange, onMerge }: Props =
  $props();
let confirmOpen = $state(false);
const readiness = $derived(mergeReadiness(detail));
const method = $derived(
  selectedMethod ?? defaultMergeMethod(detail.mergeSettings.allowedMethods),
);
const showMerge = $derived(
  detail.state === "OPEN" &&
    !detail.isDraft &&
    detail.mergeable === "MERGEABLE" &&
    detail.mergeSettings.allowedMethods.length > 0,
);

function requestMerge() {
  if (method && readiness.status === "ready") confirmOpen = true;
}

function confirmMerge() {
  if (!method) return;
  confirmOpen = false;
  onMerge?.(method);
}
</script>

<div class="rounded-md border bg-card p-4">
  <div class="flex items-start gap-3">
    <span class="grid size-8 shrink-0 place-items-center rounded-full bg-muted">
      {#if readiness.status === "ready"}
        <GitMerge class="size-4 text-success" />
      {:else}
        <TriangleAlert class="size-4 text-warning" />
      {/if}
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-semibold">
          {readiness.status === "ready"
            ? "Ready to merge"
            : readiness.status === "unknown"
              ? "Merge status pending"
              : "Merge blocked"}
        </h3>
        <Badge
          tone={readiness.status === "ready"
            ? "good"
            : readiness.status === "blocked"
              ? "warn"
              : "neutral"}
        >
          {readiness.status}
        </Badge>
      </div>
      {#if readiness.reasons.length > 0}
        <ul class="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {#each readiness.reasons as reason (reason)}
            <li>{reason}</li>
          {/each}
        </ul>
      {:else}
        <p class="mt-1 text-xs text-muted-foreground">
          GitHub will verify branch protection and permissions again.
        </p>
      {/if}
    </div>
  </div>

  {#if showMerge && method}
    <div class="mt-4">
      <SplitButton
        variant="success"
        disabled={merging || readiness.status !== "ready"}
        triggerLabel="Choose merge method"
        menuClass="w-56"
        onclick={requestMerge}
      >
        {#if merging}<Spinner class="size-3.5" />{:else}<GitMerge
            class="size-3.5"
          />{/if}
        {merging ? "Merging…" : mergeMethodLabel(method)}
        {#snippet menu()}
          {#each detail.mergeSettings.allowedMethods as option (option)}
            <DropdownMenu.Item onSelect={() => onMethodChange?.(option)}>
              <span class="w-4"
                >{#if option === method}<Check class="size-4" />{/if}</span
              >
              {mergeMethodLabel(option)}
            </DropdownMenu.Item>
          {/each}
        {/snippet}
      </SplitButton>
    </div>
  {/if}

  {#if error}
    <p class="mt-3 text-xs text-destructive" role="alert">{error}</p>
  {/if}
</div>

<Dialog.Root bind:open={confirmOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Merge pull request #{detail.number}?</Dialog.Title>
      <Dialog.Description>
        {method ? mergeMethodLabel(method) : "Merge"} will merge
        <span class="font-mono">{detail.headRefName}</span> into
        <span class="font-mono">{detail.baseRefName}</span> at head
        <span class="font-mono">{detail.headRefOid.slice(0, 7)}</span>.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (confirmOpen = false)}
        >Cancel</Button
      >
      <Button variant="success" onclick={confirmMerge}>Confirm merge</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
