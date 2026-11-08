<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import CircleX from "@lucide/svelte/icons/circle-x";
import Clock from "@lucide/svelte/icons/clock";
import GitMerge from "@lucide/svelte/icons/git-merge";
import ShieldAlert from "@lucide/svelte/icons/shield-alert";
import type {
  GithubChecksSummary,
  GithubPrCore,
  GithubPrMergeMethod,
  GithubPrOverview,
} from "@nervekit/contracts/git";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ConfirmDialog from "@nervekit/ui-kit/components/composites/confirm-dialog";
import * as DropdownMenu from "@nervekit/ui-kit/components/ui/dropdown-menu";
import { SplitButton } from "@nervekit/ui-kit/components/composites/split-button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";
import type { PrMergeFollowUp } from "../github-pr-types";
import {
  defaultMergeMethod,
  mergeAvailability,
  type MergeAvailability,
  mergeMethodLabel,
  mergeReadiness,
} from "../pr-pane-helpers";
import PrTooltip from "./PrTooltip.svelte";

type Props = {
  core: GithubPrCore;
  overview?: GithubPrOverview;
  checks?: GithubChecksSummary;
  selectedMethod?: GithubPrMergeMethod;
  merging: boolean;
  /** Where the head branch is checked out: decides the merge follow-up. */
  checkout?: "primary" | "linked";
  onMethodChange?: (method: GithubPrMergeMethod) => void;
  onMerge?: (method: GithubPrMergeMethod, followUp: PrMergeFollowUp) => void;
  onCheckout?: () => void;
  /** Draft pull requests are marked ready on GitHub. */
  onReady?: () => void;
};

let {
  core,
  overview,
  checks,
  selectedMethod,
  merging,
  checkout,
  onMethodChange,
  onMerge,
  onCheckout,
  onReady,
}: Props = $props();
let confirmOpen = $state(false);
/** The open confirmation bypasses unmet requirements. */
let bypass = $state(false);

const detail = $derived(
  overview && checks ? { ...core, ...overview, checks } : undefined,
);
const availability = $derived(
  detail
    ? mergeAvailability(mergeReadiness(detail))
    : ({
        kind: "waiting",
        reason: "Checking merge status",
        bypassable: false,
      } satisfies MergeAvailability),
);
const allowed = $derived(overview?.mergeSettings.allowedMethods ?? []);
const method = $derived(
  selectedMethod && allowed.includes(selectedMethod)
    ? selectedMethod
    : defaultMergeMethod(allowed),
);
const showMerge = $derived(core.state === "OPEN" && !core.isDraft);
const showReady = $derived(core.state === "OPEN" && core.isDraft);
const showCheckout = $derived(core.state === "OPEN" && !checkout);
/** Primary checkout: switch it to base. Linked worktree: it is done; remove it. */
const followUp = $derived<PrMergeFollowUp>(
  checkout === "primary"
    ? "switch-base-and-pull"
    : checkout === "linked"
      ? "remove-worktree"
      : "stay",
);
const followUpText = $derived(
  checkout === "primary"
    ? ` The primary action then switches the primary checkout to ${core.baseRefName} and pulls it.`
    : checkout === "linked"
      ? ` The primary action then removes the worktree that has ${core.headRefName} checked out, and deletes the local branch. A worktree with uncommitted changes is kept.`
      : "",
);

/* Colour follows mergeability; the reason is never inline text. */
const tone = $derived(
  availability.kind === "ready"
    ? undefined
    : availability.kind === "blocked"
      ? {
          variant: "destructive" as const,
          icon: CircleX,
          text: "text-destructive",
        }
      : { variant: "outline" as const, icon: Clock, text: "text-warning" },
);
/* GitHub says this viewer may merge anyway (rulesets or branch protection). */
const canBypass = $derived(
  availability.kind !== "ready" && availability.bypassable && !!method,
);
const blockers = $derived(
  availability.kind === "ready" ? undefined : availability.reason,
);
const reason = $derived(
  blockers && canBypass
    ? `${blockers} · You can bypass these requirements from the merge menu`
    : blockers,
);

function openConfirm(bypassing: boolean) {
  bypass = bypassing;
  confirmOpen = true;
}

function confirmMerge(followUp: PrMergeFollowUp) {
  confirmOpen = false;
  if (method) onMerge?.(method, followUp);
}
</script>

{#snippet mergeButton()}
  <SplitButton
    variant={tone?.variant ?? "success"}
    disabled={merging || availability.kind !== "ready" || !method}
    menuDisabled={merging || (availability.kind !== "ready" && !canBypass)}
    triggerLabel="Choose merge method"
    menuClass="w-64"
    onclick={() => openConfirm(false)}
  >
    {#if merging}<Spinner class="size-3.5" />{:else}<GitMerge
        class="size-3.5"
        aria-hidden="true"
      />{/if}
    {merging ? "Merging…" : method ? mergeMethodLabel(method) : "Merge"}
    {#snippet menu()}
      {#each allowed as option (option)}
        <DropdownMenu.Item onSelect={() => onMethodChange?.(option)}>
          <Check
            class={cn("size-3.5", option !== method && "invisible")}
            aria-hidden="true"
          />
          {mergeMethodLabel(option)}
        </DropdownMenu.Item>
      {/each}
      {#if canBypass}
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          variant="destructive"
          onSelect={() => openConfirm(true)}
        >
          <ShieldAlert aria-hidden="true" />
          Merge without waiting for requirements
        </DropdownMenu.Item>
      {/if}
    {/snippet}
  </SplitButton>
{/snippet}

<div class="flex items-center gap-1.5">
  {#if showCheckout}
    <Button variant="outline" onclick={() => onCheckout?.()}>Check out</Button>
  {/if}
  {#if showMerge}
    {#if reason && tone}
      {@const ReasonIcon = tone.icon}
      <PrTooltip label={reason}>
        <ReasonIcon class={cn("size-4", tone.text)} aria-label={reason} />
      </PrTooltip>
      <PrTooltip label={reason}>{@render mergeButton()}</PrTooltip>
    {:else}
      {@render mergeButton()}
    {/if}
  {:else if showReady}
    <Button title="Mark ready for review on GitHub" onclick={() => onReady?.()}>
      Ready for review
    </Button>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title={bypass
    ? `Bypass requirements and merge #${core.number}?`
    : `Merge pull request #${core.number}?`}
  description={`${method ? mergeMethodLabel(method) : "Merge"} will merge ${core.headRefName} into ${core.baseRefName} at head ${core.headRefOid.slice(0, 7)}.${bypass && blockers ? ` This bypasses unmet requirements: ${blockers}.` : ""}${followUpText}`}
  confirmLabel={checkout === "primary"
    ? bypass
      ? "Bypass, merge & update"
      : "Merge & update"
    : checkout === "linked"
      ? bypass
        ? "Bypass, merge & remove worktree"
        : "Merge & remove worktree"
      : bypass
        ? "Bypass and merge"
        : "Confirm merge"}
  secondaryLabel={checkout ? "Merge only" : undefined}
  confirmVariant={bypass ? "destructive" : "success"}
  onConfirm={() => confirmMerge(followUp)}
  onSecondary={() => confirmMerge("stay")}
/>
