<script lang="ts">
import Popover from "@nervekit/ui-kit/components/composites/popover-panel";
import type { ComposerLockedFields } from "../conversations/conversation-view-contracts.js";
import ComposerCapabilityPanel from "./ComposerCapabilityPanel.svelte";
import {
  ComposerCapabilities,
  type CapabilityKind,
  type ComposerCapabilityProps,
} from "./composer-capabilities.svelte.js";

let props: ComposerCapabilityProps & {
  lockedFields?: ComposerLockedFields;
} = $props();

let open = $state(false);
let tab = $state<CapabilityKind>("tools");
const capabilities = new ComposerCapabilities(
  () => props,
  () => (open = false),
);

$effect(() => {
  if (props.disabled) open = false;
});
</script>

{#each capabilities.sections as section (section.kind)}
  <Popover
    open={open && tab === section.kind}
    onOpenChange={(next) => {
      if (next) {
        tab = section.kind;
        open = !props.disabled;
      } else if (tab === section.kind) {
        open = false;
      }
    }}
    size="md"
    triggerClass="composer-tab w-control p-0"
    ariaLabel={section.title}
    triggerTitle={props.error
      ? `${section.title} unavailable: ${props.error}`
      : `${section.title}${section.count ? ` (${section.count})` : ""}`}
    side="top"
    align="start"
    presentation="adaptive"
  >
    {#snippet trigger()}
      <span
        class={`relative inline-flex items-center ${props.disabled ? "opacity-60" : ""}`}
        data-tour-id={`composer-${section.kind}`}
      >
        <section.icon aria-hidden="true" />
        {#if capabilities.overrideCounts[section.kind] > 0}
          <span
            class="composer-badge-dot absolute -top-1 -right-1.5"
            aria-hidden="true"
          ></span>
        {/if}
      </span>
    {/snippet}
    <ComposerCapabilityPanel {capabilities} kind={section.kind} />
  </Popover>
{/each}
