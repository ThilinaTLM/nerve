<script lang="ts">
  import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
  import Plus from "@lucide/svelte/icons/plus";
  import Server from "@lucide/svelte/icons/server";
  import { Button } from "@nervekit/workbench-ui/components/ui/button";
  import {
    ConversationGroupNavigator,
    type ConversationNavigatorGroup,
    type ConversationNavigatorItem,
  } from "@nervekit/workbench-ui/components/navigator";
  import { untrack } from "svelte";
  import { useSandboxCenter } from "../../state/sandbox-center.svelte";
  import {
    conversationItemsFor,
    sandboxConversationActivity,
    type SandboxConversationListItem,
  } from "../../state/sandbox-manager-selectors.svelte";
  import { sandboxCanCreateConversation } from "../../state/sandbox-lifecycle";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import {
    loadSandboxGroupCollapseState,
    saveSandboxGroupCollapseState,
    type SandboxGroupCollapseState,
  } from "../../state/sandbox-group-collapse";

  const store = useSandboxManagerStore();
  const center = useSandboxCenter();

  let query = $state("");
  let collapsed = $state<SandboxGroupCollapseState>(
    loadSandboxGroupCollapseState(),
  );

  type DurableConversationItem = Extract<
    SandboxConversationListItem,
    { kind: "durable" }
  >;
  function isDurable(
    conversation: SandboxConversationListItem,
  ): conversation is DurableConversationItem {
    return conversation.kind === "durable";
  }

  function groupOpen(sandboxId: string): boolean {
    if (sandboxId === center.selectedSandboxId) return true;
    return !collapsed[sandboxId];
  }

  const groups = $derived.by<ConversationNavigatorGroup[]>(() =>
    store.sandboxes.map((record) => {
      const conversations = conversationItemsFor(store, record.sandboxId).filter(
        isDurable,
      );
      const detail = store.details[record.sandboxId];
      const selectedSandbox = record.sandboxId === center.selectedSandboxId;
      return {
        id: record.sandboxId,
        title: record.name ?? record.sandboxId,
        searchText: `${record.sandboxId} ${record.observedState}`,
        icon: Server,
        meta: conversations.length > 0 ? String(conversations.length) : undefined,
        open: groupOpen(record.sandboxId),
        emptyLabel: "No conversations.",
        items: conversations.map((conversation) => {
          const activity = sandboxConversationActivity(conversation, detail);
          const open =
            detail?.openWorkspaceTabs?.some(
              (tab) =>
                tab.kind === "chat" && tab.id === conversation.conversationId,
            ) ?? false;
          return {
            id: conversation.conversationId,
            title: conversation.title ?? conversation.conversationId,
            searchText: `${conversation.conversationId} ${conversation.mode ?? ""}`,
            active:
              selectedSandbox &&
              conversation.conversationId === detail?.selectedConversationId,
            open,
            statusTone: activity.tone,
            statusPulse: activity.pulse,
            statusLabel: activity.label,
            metadata: {
              mode: conversation.mode,
              updated: conversation.updatedAt
                ? new Date(conversation.updatedAt).toLocaleString()
                : undefined,
            },
          } satisfies ConversationNavigatorItem;
        }),
      };
    }),
  );

  function setGroupOpen(group: ConversationNavigatorGroup, open: boolean): void {
    if (open) {
      delete collapsed[group.id];
      center.openSandbox(group.id);
      void store.ensureConversations(group.id);
    } else {
      collapsed[group.id] = true;
    }
    saveSandboxGroupCollapseState({ ...collapsed });
  }

  $effect(() => {
    const sandboxId = center.selectedSandboxId;
    if (sandboxId) untrack(() => void store.ensureConversations(sandboxId));
  });

  function selectConversation(
    item: ConversationNavigatorItem,
    group: ConversationNavigatorGroup,
  ): void {
    center.openSandbox(group.id);
    store.selectConversation(group.id, item.id);
  }
</script>

<ConversationGroupNavigator
  {groups}
  bind:searchValue={query}
  placeholder="Search sandboxes / conversations"
  onGroupOpenChange={setGroupOpen}
  onSelect={selectConversation}
>
  {#snippet groupActions(group)}
    {@const record = store.sandboxes.find((item) => item.sandboxId === group.id)}
    {@const detail = store.details[group.id]}
    <Button
      size="icon-xs"
      variant="ghost"
      title="Open sandbox summary"
      ariaLabel="Open sandbox summary"
      onclick={() => {
        center.openSandbox(group.id);
        store.openWorkspaceSummaryTab(group.id);
        void store.ensureConversations(group.id);
      }}
    >
      <LayoutDashboard />
    </Button>
    <Button
      size="icon-xs"
      variant="ghost"
      title="New conversation"
      ariaLabel="New conversation"
      disabled={!sandboxCanCreateConversation(record, detail)}
      onclick={() => {
        center.openSandbox(group.id);
        store.startNewConversation(group.id);
      }}
    >
      <Plus />
    </Button>
  {/snippet}

  {#snippet itemTooltip(item)}
    <span class="tt-title">{item.title}</span>
    <span class="tt-id">{item.id}</span>
    <span class="tt-row"><span class="tt-key">status</span>{item.statusLabel}</span>
    {#if item.metadata?.mode}
      <span class="tt-row"><span class="tt-key">mode</span>{item.metadata.mode}</span>
    {/if}
    {#if item.metadata?.updated}
      <span class="tt-row"><span class="tt-key">updated</span>{item.metadata.updated}</span>
    {/if}
  {/snippet}
</ConversationGroupNavigator>
