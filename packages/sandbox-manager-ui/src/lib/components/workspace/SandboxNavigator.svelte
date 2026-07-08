<script lang="ts">
  import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
  import Plus from "@lucide/svelte/icons/plus";
  import Server from "@lucide/svelte/icons/server";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { NavigatorItem, NavigatorPanel } from "@nervekit/ui/components/navigator";
  import { PanelSection } from "@nervekit/ui/components/workbench";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { untrack } from "svelte";
  import { useSandboxCenter } from "../../state/sandbox-center.svelte";
  import {
    conversationItemsFor,
    sandboxConversationActivity,
    type SandboxConversationListItem,
  } from "../../state/sandbox-manager-selectors.svelte";
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

  const needle = $derived(query.trim().toLowerCase());

  // Match the web project navigator: only durable conversations are listed
  // (drafts stay as an open center tab until the first message is sent).
  type DurableConversationItem = Extract<
    SandboxConversationListItem,
    { kind: "durable" }
  >;
  function isDurable(
    conversation: SandboxConversationListItem,
  ): conversation is DurableConversationItem {
    return conversation.kind === "durable";
  }

  function matches(record: ManagedSandboxRecord): boolean {
    if (!needle) return true;
    const conversationTitles = conversationItemsFor(store, record.sandboxId)
      .filter(isDurable)
      .map(
        (conversation) =>
          `${conversation.title ?? ""} ${conversation.conversationId}`,
      )
      .join(" ");
    const haystack =
      `${record.name ?? ""} ${record.sandboxId} ${record.observedState} ${conversationTitles}`.toLowerCase();
    return haystack.includes(needle);
  }

  const groups = $derived(store.sandboxes.filter(matches));

  function groupOpen(record: ManagedSandboxRecord): boolean {
    if (record.sandboxId === center.selectedSandboxId) return true;
    return !collapsed[record.sandboxId];
  }

  function setGroupOpen(record: ManagedSandboxRecord, open: boolean): void {
    if (open) {
      delete collapsed[record.sandboxId];
      center.openSandbox(record.sandboxId);
      void store.ensureConversations(record.sandboxId);
    } else {
      collapsed[record.sandboxId] = true;
    }
    saveSandboxGroupCollapseState({ ...collapsed });
  }

  // Load conversations for the active sandbox so its group renders its list.
  // Only the active sandbox id should trigger this effect; the fetch applies a
  // snapshot, and tracking that state here can create a fetch -> snapshot ->
  // effect loop for sandboxes with no conversations yet.
  $effect(() => {
    const sandboxId = center.selectedSandboxId;
    if (sandboxId) untrack(() => void store.ensureConversations(sandboxId));
  });

  function selectConversation(sandboxId: string, conversationId: string): void {
    center.openSandbox(sandboxId);
    store.selectConversation(sandboxId, conversationId);
  }
</script>

<NavigatorPanel
  bind:searchValue={query}
  placeholder="Search sandboxes / conversations"
  searchAriaLabel="Search sandboxes or conversations"
>
  {#if groups.length === 0}
    <p class="empty">No sandboxes yet.</p>
  {/if}

  {#each groups as record (record.sandboxId)}
    {@const conversations = conversationItemsFor(store, record.sandboxId).filter(isDurable)}
    {@const detail = store.details[record.sandboxId]}
    {@const selectedSandbox = record.sandboxId === center.selectedSandboxId}
    <PanelSection
      title={record.name ?? record.sandboxId}
      icon={Server}
      open={groupOpen(record)}
      onOpenChange={(open) => setGroupOpen(record, open)}
    >
      {#snippet meta()}
        {#if conversations.length > 0}
          <span class="conversation-count">{conversations.length}</span>
        {/if}
      {/snippet}
      {#snippet actions()}
        <Button
          size="icon-xs"
          variant="ghost"
          title="Open sandbox summary"
          ariaLabel="Open sandbox summary"
          onclick={() => {
            center.openSandbox(record.sandboxId);
            store.openWorkspaceSummaryTab(record.sandboxId);
            void store.ensureConversations(record.sandboxId);
          }}
        >
          <LayoutDashboard />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          title="New conversation"
          ariaLabel="New conversation"
          onclick={() => {
            center.openSandbox(record.sandboxId);
            store.startNewConversation(record.sandboxId);
          }}
        >
          <Plus />
        </Button>
      {/snippet}

      <div class="conversation-list">
        {#if conversations.length === 0}
          <p class="empty child">No conversations.</p>
        {/if}
        {#each conversations as conversation (conversation.conversationId)}
          {@const conversationActivity = sandboxConversationActivity(conversation, detail)}
          {@const open =
            detail?.openWorkspaceTabs?.some(
              (tab) => tab.kind === "chat" && tab.id === conversation.conversationId,
            ) ?? false}
          {@const active =
            selectedSandbox &&
            conversation.conversationId === detail?.selectedConversationId}
          <NavigatorItem
            title={conversation.title ?? conversation.conversationId}
            {active}
            isOpen={open}
            statusTone={conversationActivity.tone}
            statusPulse={conversationActivity.pulse}
            statusLabel={conversationActivity.label}
            tooltipClass="conversation-tooltip"
            onSelect={() =>
              selectConversation(record.sandboxId, conversation.conversationId)}
          >
            {#snippet tooltip()}
              <span class="tt-title">{conversation.title ?? conversation.conversationId}</span>
              <span class="tt-id">{conversation.conversationId}</span>
              <span class="tt-row"><span class="tt-key">status</span>{conversationActivity.label}</span>
              {#if conversation.mode}
                <span class="tt-row"><span class="tt-key">mode</span>{conversation.mode}</span>
              {/if}
              {#if conversation.updatedAt}
                <span class="tt-row"><span class="tt-key">updated</span>{new Date(conversation.updatedAt).toLocaleString()}</span>
              {/if}
            {/snippet}
          </NavigatorItem>
        {/each}
      </div>
    </PanelSection>
  {/each}
</NavigatorPanel>

<style>
  .empty {
    margin: 0.5rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .empty.child {
    margin: 0.2rem 0.1rem 0.1rem;
  }

  .conversation-list {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    margin: -0.35rem -0.55rem;
  }

  .conversation-count {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 400;
  }
</style>
