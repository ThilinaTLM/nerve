<script lang="ts">
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import ConversationPaneLayout from "./ConversationPaneLayout.svelte";
import { createConversationScrollController } from "../transcript/conversation-scroll.svelte";
import TranscriptList from "../transcript/TranscriptList.svelte";
import AgentComposer from "./AgentComposer.svelte";
import ConversationEmptyState from "./ConversationEmptyState.svelte";
import type {
  ConversationPaneModel,
  ConversationPaneActions,
  ConversationMenuBuilders,
} from "./conversation-view-contracts";
let {
  model,
  actions,
  menus,
  composer: composerExtension,
  emptyExtension,
}: {
  model: ConversationPaneModel;
  actions: ConversationPaneActions;
  menus?: ConversationMenuBuilders;
  composer?: Snippet;
  emptyExtension?: Snippet;
} = $props();
const scroll = createConversationScrollController({
  active: () => model.active ?? true,
  conversationOpen: () => model.open,
  conversationId: () => model.conversationId,
  contentReady: () =>
    model.timeline.prefix.length + model.timeline.tail.length > 0,
});
</script>

<ConversationPaneLayout
  open={model.open}
  showScrollButton={!scroll.atEnd}
  composerHeight={scroll.composerHeight}
  bind:composerWrapRef={scroll.composerWrapEl}
  onJumpToBottom={() => scroll.jumpToBottom()}
>
  {#snippet transcript()}
    <div class="flex h-full min-h-0 flex-col">
      {#if model.parent}
        <nav
          class="flex min-w-0 items-center gap-1 px-4 py-2 text-xs text-muted-foreground"
          aria-label="Conversation breadcrumb"
        >
          <Button
            variant="ghost"
            size="xs"
            class="min-w-0 truncate text-muted-foreground"
            onclick={() => actions.onOpenConversation?.(model.parent!.id)}
            >{model.parent.title}</Button
          >
          <ChevronRight size={12} /><span class="truncate">{model.title}</span>
        </nav>
      {/if}
      <TranscriptList
        bind:controller={scroll.controller}
        bind:atEnd={scroll.atEnd}
        followBottom={scroll.followBottom}
        heightCacheKey={model.conversationId}
        rows={[...model.timeline.prefix, ...model.timeline.tail]}
        queuedPrompts={model.queuedPrompts}
        children={model.children}
        {actions}
        {menus}
        sending={model.sending}
        hasOlder={model.hasOlder}
        loadingOlder={model.loadingOlder}
      />
      {#if model.error}<p class="px-4 text-xs text-destructive" role="alert">
          {model.error}
        </p>{/if}
    </div>
  {/snippet}
  {#snippet composer()}{#if composerExtension}{@render composerExtension()}{:else}<AgentComposer
        model={model.composer}
        {actions}
      />{/if}{/snippet}
  {#snippet empty()}{#if emptyExtension}{@render emptyExtension()}{:else}<ConversationEmptyState
      />{/if}{/snippet}
</ConversationPaneLayout>
