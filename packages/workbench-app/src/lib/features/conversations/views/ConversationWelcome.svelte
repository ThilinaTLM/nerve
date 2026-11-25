<script lang="ts">
import ShieldCheck from "@lucide/svelte/icons/shield-check";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { ConversationSignal, conversationStarters } from "$lib/presentation";

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
  /** The project's undecided items, as one line; `onOpen` opens the first. */
  review?: { text: string; onOpen: () => void };
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
  footer={review ? reviewLine : undefined}
/>

{#snippet reviewLine()}
  {#if review}
    <p class="flex items-center gap-1.5 text-caption text-muted-foreground">
      <ShieldCheck class="size-3.5 text-warning" aria-hidden="true" />
      <span>{review.text} ·</span>
      <Button variant="link" size="sm" onclick={review.onOpen}>Review</Button>
    </p>
  {/if}
{/snippet}
