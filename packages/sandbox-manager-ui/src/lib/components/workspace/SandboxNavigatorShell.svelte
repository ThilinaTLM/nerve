<script lang="ts">
  import MessageSquare from "@lucide/svelte/icons/message-square";
  import Plus from "@lucide/svelte/icons/plus";
  import Search from "@lucide/svelte/icons/search";
  import Server from "@lucide/svelte/icons/server";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Input } from "@nervekit/ui/components/ui/input";
  import { ScrollArea } from "@nervekit/ui/components/ui/scroll-area";
  import { StatusDot } from "@nervekit/ui/components/ui/status-dot";
  import { PanelSection } from "@nervekit/ui/components/workbench";
  import { activityFor } from "../../state/sandbox-manager-selectors.svelte";
  import { useSandboxManagerStore } from "../../state/sandbox-manager-state.svelte";
  import { observedStateTone } from "../../state/sandbox-status";

  let {
    activeSandboxId,
    onSelectSandbox,
    onSelectConversation,
    onCreateSandbox,
    onNewConversation,
  }: {
    activeSandboxId: string;
    onSelectSandbox: (sandboxId: string) => void;
    onSelectConversation: (conversationId: string) => void;
    onCreateSandbox: () => void;
    onNewConversation: () => void;
  } = $props();

  const store = useSandboxManagerStore();
  const detail = $derived(store.details[activeSandboxId]);
  let query = $state("");
  let sandboxesOpen = $state(true);
  let conversationsOpen = $state(true);

  const filteredSandboxes = $derived(
    store.sandboxes.filter((record) => {
      const haystack = `${record.name ?? ""} ${record.sandboxId} ${record.observedState}`.toLowerCase();
      return haystack.includes(query.trim().toLowerCase());
    }),
  );
</script>

<div class="flex h-full w-full flex-col bg-sidebar">
  <div class="flex flex-none items-center justify-between gap-2 border-b px-3 py-2">
    <span class="text-sm font-semibold">Workspace</span>
    <Button variant="ghost" size="icon-sm" ariaLabel="New sandbox" title="New sandbox" onclick={onCreateSandbox}>
      <Plus class="size-4" />
    </Button>
  </div>

  <div class="flex flex-none items-center gap-2 border-b px-2 py-2">
    <Search class="size-3.5 text-muted-foreground" />
    <Input bind:value={query} placeholder="Search sandboxes" class="h-7 min-w-0 text-xs" />
  </div>

  <ScrollArea class="min-h-0 flex-1">
    <div class="flex flex-col gap-2 p-2">
      <PanelSection title="Sandboxes" icon={Server} bind:open={sandboxesOpen} contentClass="px-1 py-1">
        <ul class="flex flex-col gap-0.5">
          {#each filteredSandboxes as record (record.sandboxId)}
            {@const activity = activityFor(store, record.sandboxId)}
            {@const active = record.sandboxId === activeSandboxId}
            {@const running = activity?.runStatus === "running" && record.observedState === "running"}
            <li>
              <button
                type="button"
                class={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted ${active ? "bg-muted" : ""}`}
                aria-current={active ? "page" : undefined}
                onclick={() => onSelectSandbox(record.sandboxId)}
              >
                <span class="mt-1">
                  <StatusDot
                    tone={activity?.needsAttention ? "warn" : running ? "good" : observedStateTone(record.observedState)}
                    size="xs"
                    pulse={running}
                  />
                </span>
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="truncate text-xs font-medium">{record.name ?? record.sandboxId}</span>
                  <span class="truncate text-xs text-muted-foreground">{activity?.title ?? record.observedState}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </PanelSection>

      <PanelSection title="Conversations" icon={MessageSquare} bind:open={conversationsOpen} contentClass="px-1 py-1">
        <div class="flex flex-col gap-1">
          <Button size="xs" variant="ghost" class="justify-start" onclick={onNewConversation}>
            <Plus class="size-3.5" /> New conversation
          </Button>
          {#if (detail?.snapshot?.conversations.length ?? 0) > 0}
            <ul class="flex flex-col gap-0.5">
              {#each detail?.snapshot?.conversations ?? [] as conversation (conversation.conversationId)}
                {@const active = conversation.conversationId === detail?.selectedConversationId}
                <li>
                  <button
                    type="button"
                    class={`flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted ${active ? "bg-muted text-foreground" : "text-muted-foreground"}`}
                    onclick={() => onSelectConversation(conversation.conversationId)}
                  >
                    <span class="truncate font-medium">{conversation.title ?? conversation.conversationId}</span>
                    <span class="truncate font-mono text-[0.68rem]">{conversation.conversationId}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="px-2 py-1 text-xs text-muted-foreground">No saved conversations yet.</p>
          {/if}
        </div>
      </PanelSection>
    </div>
  </ScrollArea>
</div>
