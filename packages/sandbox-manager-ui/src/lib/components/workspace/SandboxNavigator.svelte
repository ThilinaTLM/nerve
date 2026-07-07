<script lang="ts">
  import Plus from "@lucide/svelte/icons/plus";
  import Server from "@lucide/svelte/icons/server";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { NavigatorItem, NavigatorPanel } from "@nervekit/ui/components/navigator";
  import { PanelSection } from "@nervekit/ui/components/workbench";
  import type { ManagedSandboxRecord } from "@nervekit/shared";
  import { useSandboxCenter } from "../../state/sandbox-center.svelte";
  import {
    activityFor,
    conversationsFor,
  } from "../../state/sandbox-manager-selectors.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import {
    loadSandboxGroupCollapseState,
    saveSandboxGroupCollapseState,
    type SandboxGroupCollapseState,
  } from "../../state/sandbox-group-collapse";
  import { observedStateTone } from "../../state/sandbox-status";

  const store = useSandboxManagerStore();
  const center = useSandboxCenter();

  let query = $state("");
  let collapsed = $state<SandboxGroupCollapseState>(
    loadSandboxGroupCollapseState(),
  );

  const needle = $derived(query.trim().toLowerCase());

  function matches(record: ManagedSandboxRecord): boolean {
    if (!needle) return true;
    const conversationTitles = conversationsFor(store, record.sandboxId)
      .map((conversation) => `${conversation.title ?? ""} ${conversation.conversationId}`)
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
  $effect(() => {
    if (center.selectedSandboxId)
      void store.ensureConversations(center.selectedSandboxId);
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
    {@const activity = activityFor(store, record.sandboxId)}
    {@const conversations = conversationsFor(store, record.sandboxId)}
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
          {@const running = (conversation.activeRunIds?.length ?? 0) > 0}
          {@const active =
            selectedSandbox &&
            conversation.conversationId ===
              store.details[record.sandboxId]?.selectedConversationId}
          <NavigatorItem
            title={conversation.title ?? conversation.conversationId}
            subtitle={conversation.conversationId}
            mono
            {active}
            isOpen={active}
            statusTone={running
              ? "running"
              : activity?.needsAttention
                ? "warn"
                : observedStateTone(record.observedState)}
            statusPulse={running}
            onSelect={() =>
              selectConversation(record.sandboxId, conversation.conversationId)}
          />
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
