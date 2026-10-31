<script lang="ts">
import Check from "@lucide/svelte/icons/check";
import CircleX from "@lucide/svelte/icons/circle-x";
import Clock from "@lucide/svelte/icons/clock";
import GitMerge from "@lucide/svelte/icons/git-merge";
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
  checkedOut: boolean;
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
  checkedOut,
  onMethodChange,
  onMerge,
  onCheckout,
  onReady,
}: Props = $props();
let confirmOpen = $state(false);

const detail = $derived(
  overview && checks ? { ...core, ...overview, checks } : undefined,
);
const availability = $derived(
  detail
    ? mergeAvailability(mergeReadiness(detail))
    : ({ kind: "waiting", reason: "Checking merge status" } as const),
);
const allowed = $derived(overview?.mergeSettings.allowedMethods ?? []);
const method = $derived(
  selectedMethod && allowed.includes(selectedMethod)
    ? selectedMethod
    : defaultMergeMethod(allowed),
);
const showMerge = $derived(core.state === "OPEN" && !core.isDraft);
const showReady = $derived(core.state === "OPEN" && core.isDraft);
const showCheckout = $derived(core.state === "OPEN" && !checkedOut);

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
const reason = $derived(
  availability.kind === "ready" ? undefined : availability.reason,
);

function confirmMerge(followUp: PrMergeFollowUp) {
  confirmOpen = false;
  if (method) onMerge?.(method, followUp);
}
</script>

{#snippet mergeButton()}
  <SplitButton
    variant={tone?.variant ?? "success"}
    disabled={merging || availability.kind !== "ready" || !method}
    triggerLabel="Choose merge method"
    menuClass="w-56"
    onclick={() => (confirmOpen = true)}
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
  title={`Merge pull request #${core.number}?`}
  description={`${method ? mergeMethodLabel(method) : "Merge"} will merge ${core.headRefName} into ${core.baseRefName} at head ${core.headRefOid.slice(0, 7)}.${checkedOut ? ` The primary action then switches this checkout to ${core.baseRefName} and pulls it.` : ""}`}
  confirmLabel={checkedOut ? "Merge & update" : "Confirm merge"}
  secondaryLabel={checkedOut ? "Merge only" : undefined}
  confirmVariant="success"
  onConfirm={() => confirmMerge(checkedOut ? "switch-base-and-pull" : "stay")}
  onSecondary={() => confirmMerge("stay")}
/>
