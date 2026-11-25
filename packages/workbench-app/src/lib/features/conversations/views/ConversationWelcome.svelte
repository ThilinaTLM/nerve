<script lang="ts">
import {
  ConversationSignal,
  conversationStarters,
  type ProjectReviewReminder,
} from "$lib/presentation";

let {
  onNewChat,
  projectSelected = false,
  projectId,
  projectLabel,
  projectPath,
  availableProfiles,
  defaultProfile,
  review,
}: {
  onNewChat: (profile: string) => void;
  projectSelected?: boolean;
  projectId?: string;
  projectLabel?: string;
  projectPath?: string;
  /** Selectable lead profile names; all starters show until they load. */
  availableProfiles?: readonly string[];
  defaultProfile?: string;
  review?: ProjectReviewReminder;
} = $props();

const starters = $derived(
  availableProfiles?.length
    ? conversationStarters.filter((starter) =>
        availableProfiles.includes(starter.profile),
      )
    : conversationStarters,
);
</script>

<ConversationSignal
  variant="launchpad"
  title="Let's give this repo a plot twist."
  message={projectSelected
    ? "Pick how you want to work."
    : "Bring a project. We'll bring the momentum."}
  {projectLabel}
  {projectPath}
  {projectId}
  {starters}
  defaultStarter={defaultProfile}
  startersDisabled={!projectSelected}
  onSelectStarter={(starter) => onNewChat(starter.profile)}
  {review}
/>
