<script lang="ts">
import { profileIcon } from "./composer-icons";
import {
  PopoverFooter,
  PopoverHeader,
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { composerProfileItems } from "./composer-profile-items.js";
import type { ComposerAgentProfile } from "../conversations/conversation-view-contracts.js";

/** Agent profile list, shared by the profile picker and the compact
 * conversation-settings panel. Profiles that wait for the user's review are
 * listed disabled, with Review in the footer. */
let {
  agentProfiles,
  agentProfile,
  pendingProfiles = [],
  disabled = false,
  onSelect,
  onBack,
  onReview,
}: {
  agentProfiles: ComposerAgentProfile[];
  agentProfile: string;
  pendingProfiles?: ComposerAgentProfile[];
  disabled?: boolean;
  onSelect: (name: string) => void;
  onBack?: () => void;
  /** Opens the review dialog on the waiting profiles, starting with this one. */
  onReview?: (name: string) => void;
} = $props();

const pendingNames = $derived(
  new Set(pendingProfiles.map((profile) => profile.name)),
);
const profileItems = $derived(
  composerProfileItems([
    ...agentProfiles,
    ...pendingProfiles.map((profile) => ({
      ...profile,
      whenToUse: "Waiting for your review",
    })),
  ]),
);
const firstPending = $derived(pendingProfiles[0]);
</script>

<PopoverHeader title="Agent profile" {onBack} />
<PopoverCommandList
  items={profileItems}
  ariaLabel="Agent profiles"
  placeholder="Search profiles"
  isSelected={(profile) => profile.name === agentProfile}
  isDisabled={(profile) => disabled || pendingNames.has(profile.name)}
  onChoose={(profile) => onSelect(profile.name)}
>
  {#snippet icon(profile)}
    {@const Icon = profileIcon(profile.name)}
    <Icon class="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
  {/snippet}
</PopoverCommandList>
{#if firstPending && onReview}
  <PopoverFooter class="justify-between [&>button]:flex-none">
    <span class="min-w-0 truncate px-1.5 text-muted-foreground"
      >{pendingProfiles.length === 1
        ? `${firstPending.label} waits for your review`
        : `${pendingProfiles.length} profiles wait for your review`}</span
    >
    <Button
      size="sm"
      variant="outline"
      onclick={() => onReview(firstPending.name)}>Review</Button
    >
  </PopoverFooter>
{/if}
