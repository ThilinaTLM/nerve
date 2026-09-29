<script lang="ts">
import EllipsisVertical from "@lucide/svelte/icons/ellipsis-vertical";
import Info from "@lucide/svelte/icons/info";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { MobileActionSheet, MobileScreen } from "$lib/presentation/shell";
import { ConversationCenterHost } from "$lib/app/composition/registries/center-view-registry";
import { tabIdentity, tabLabel } from "$lib/app/shell/editor-tab-helpers";
import {
  workspaceSelectors,
  type CenterTabIdentity,
} from "$lib/application/workspace";
import { mobileConversationMenu } from "./mobile-conversation-menu.svelte";
import type { MobileCenterIdentity } from "./mobile-routes";
import { backFromMobileScreen, pushMobileScreen } from "./mobile-shell.svelte";

/**
 * A conversation as a phone screen: transcript and composer get the whole
 * viewport; context and conversation actions sit in the header.
 */
let {
  identity,
  visible,
}: {
  identity: MobileCenterIdentity;
  visible: boolean;
} = $props();

const tab = $derived(identity as CenterTabIdentity);
const conversation = $derived(
  identity.kind === "conversation"
    ? workspaceSelectors.conversations.find(
        (candidate) => candidate.id === identity.id,
      )
    : undefined,
);
const tabModel = $derived(
  workspaceSelectors.centerTabs.find((candidate) => {
    const candidateIdentity = tabIdentity(candidate);
    return (
      candidateIdentity.kind === identity.kind &&
      candidateIdentity.id === identity.id
    );
  }),
);
const title = $derived(
  conversation?.title ?? (tabModel ? tabLabel(tabModel) : "New chat"),
);
const projectName = $derived.by(() => {
  const projectId =
    conversation?.projectId ?? workspaceSelectors.activeProject?.id;
  return workspaceSelectors.projects.find((project) => project.id === projectId)
    ?.name;
});
const menuItems = $derived(
  conversation ? mobileConversationMenu(conversation) : [],
);

let menuOpen = $state(false);
</script>

<MobileScreen
  {title}
  subtitle={projectName}
  onBack={backFromMobileScreen}
  backLabel="Back"
  scroll={false}
>
  {#snippet actions()}
    {#if conversation}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Conversation context"
        onclick={() =>
          pushMobileScreen({ kind: "context", conversationId: identity.id })}
      >
        <Info size={18} strokeWidth={1.9} />
      </Button>
    {/if}
    {#if menuItems.length}
      <Button
        variant="ghost"
        size="icon-sm"
        ariaLabel="Conversation actions"
        onclick={() => (menuOpen = true)}
      >
        <EllipsisVertical size={18} strokeWidth={1.9} />
      </Button>
    {/if}
  {/snippet}
  <ConversationCenterHost {tab} active={visible} />
</MobileScreen>

{#if menuItems.length}
  <MobileActionSheet
    open={menuOpen}
    {title}
    items={menuItems}
    onOpenChange={(open) => (menuOpen = open)}
  />
{/if}
