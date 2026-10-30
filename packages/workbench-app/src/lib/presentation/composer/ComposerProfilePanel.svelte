<script lang="ts">
import { profileIcon } from "./composer-icons";
import {
  PopoverHeader,
  PopoverCommandList,
} from "@nervekit/ui-kit/components/composites/popover-panel";
import { composerProfileItems } from "./composer-profile-items.js";
import type { ComposerAgentProfile } from "../conversations/conversation-view-contracts.js";

/** Agent profile list, shared by the profile picker and the compact
 * conversation-settings panel. */
let {
  agentProfiles,
  agentProfile,
  disabled = false,
  onSelect,
  onBack,
}: {
  agentProfiles: ComposerAgentProfile[];
  agentProfile: string;
  disabled?: boolean;
  onSelect: (name: string) => void;
  onBack?: () => void;
} = $props();

const profileItems = $derived(composerProfileItems(agentProfiles));
</script>

<PopoverHeader title="Agent profile" {onBack} />
<PopoverCommandList
  items={profileItems}
  ariaLabel="Agent profiles"
  placeholder="Search profiles"
  isSelected={(profile) => profile.name === agentProfile}
  isDisabled={() => disabled}
  onChoose={(profile) => onSelect(profile.name)}
>
  {#snippet icon(profile)}
    {@const Icon = profileIcon(profile.name)}
    <Icon class="size-3.5 flex-none text-muted-foreground" aria-hidden="true" />
  {/snippet}
</PopoverCommandList>
