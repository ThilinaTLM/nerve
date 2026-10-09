<script lang="ts">
import { composerSignals } from "$lib/features/conversations/state/composer-signals.svelte";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import type { ConversationMenuBuilders } from "$lib/presentation/conversations/conversation-view-contracts";
import { setConversationUiCapabilities } from "$lib/presentation/context.svelte";
import { voiceInputSession } from "$lib/features/conversations/audio/voice-input-session.svelte";
import {
  appendTranscriptText,
  voiceInputTargetKey,
} from "$lib/features/conversations/audio/voice-input-target";
import TranscriptionActivity from "$lib/features/conversations/audio/TranscriptionActivity.svelte";
import {
  AudioInputAuthRequiredDialog,
  chatGptAudioAuth,
} from "$lib/features/audio";
import { uploadClipboardImage } from "$lib/features/filesystem";
import { retainConversationStore } from "$lib/features/conversations/state/open-conversation-stores";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import { conversationTranscript } from "$lib/features/conversations/adapters/core-transcript.adapter";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import { openConversation } from "$lib/application/workspace/workspace-actions.svelte";
import { ConversationPane } from "$lib/presentation/conversations";
import { openFilePane, getFileContent } from "$lib/features/filesystem";
import TranscriptList from "$lib/presentation/transcript/TranscriptList.svelte";
import SubagentTranscriptDialog from "$lib/presentation/tools/tool-call/SubagentTranscriptDialog.svelte";
import WorkbenchComposerAdapter from "./WorkbenchComposerAdapter.svelte";
import ConversationHistoryDialog from "$lib/features/conversations/views/ConversationHistoryDialog.svelte";
import type {
  ConversationPaneActions,
  ConversationPaneModel,
} from "$lib/presentation/conversations/conversation-view-contracts";
setConversationUiCapabilities({
  voice: {
    session: voiceInputSession,
    targetKey: voiceInputTargetKey,
    appendTranscriptText,
    chatGptConfigured: () => chatGptAudioAuth.configured,
    TranscriptionActivity,
    AudioAuthDialog: AudioInputAuthRequiredDialog,
  },
  askReply: { pasteImage: uploadClipboardImage },
});
let {
  conversationId,
  active = true,
}: { conversationId: string; active?: boolean } = $props();
let store = $state<ConversationStore>();
let peekStore = $state<ConversationStore>();
let peek = $state<{ id: string; title: string }>();
let peekOpen = $state(false);
let historyOpen = $state(false);
$effect(() => {
  if (active && composerSignals.historyDialogOpen) {
    historyOpen = true;
    composerSignals.historyDialogOpen = false;
  }
});
let text = $state("");
let editTarget = $state<{ eventId: string; previousEventId: string | null }>();
let parent = $state<{ id: string; title: string }>();
let actionError = $state<string>();
$effect(() => {
  const retained = retainConversationStore(conversationId);
  store = retained.store;
  text = "";
  editTarget = undefined;
  void retained.ready.catch(() => {});
  return retained.release;
});
$effect(() => {
  const id = store?.snapshot?.conversation.parentConversationId;
  parent = undefined;
  if (!id) return;
  let current = true;
  void requestConversation("conversation.getSnapshot", { conversationId: id })
    .then((snapshot) => {
      if (current) parent = { id, title: snapshot.conversation.title };
    })
    .catch(() => {});
  return () => {
    current = false;
  };
});
$effect(() => {
  if (!peekOpen || !peek) {
    peekStore = undefined;
    return;
  }
  const retained = retainConversationStore(peek.id);
  peekStore = retained.store;
  void retained.ready.catch(() => {});
  return retained.release;
});
const rows = $derived(
  store?.snapshot
    ? conversationTranscript({
        snapshot: store.snapshot,
        events: store.events,
        liveBlocks: store.liveBlocks,
        toolOutput: store.toolOutput,
      })
    : [],
);
const peekRows = $derived(
  peekStore?.snapshot
    ? conversationTranscript({
        snapshot: peekStore.snapshot,
        events: peekStore.events,
        liveBlocks: peekStore.liveBlocks,
        toolOutput: peekStore.toolOutput,
      })
    : [],
);
async function act(fn: () => Promise<unknown>) {
  actionError = undefined;
  try {
    await fn();
  } catch (e) {
    actionError = e instanceof Error ? e.message : String(e);
  }
}
async function submitPrompt(submitted: string) {
  const currentStore = store;
  if (!currentStore) throw new Error("Conversation is not ready");
  const target = editTarget;
  if (target) await currentStore.selectHead(target.previousEventId);
  await currentStore.submit(submitted);
  if (editTarget?.eventId === target?.eventId) {
    editTarget = undefined;
    if (text === submitted) text = "";
  }
}
const actions: ConversationPaneActions = {
  onEditMessage: (eventId, originalText, previousEventId) => {
    text = originalText;
    editTarget = { eventId, previousEventId };
    composerSignals.focusToken += 1;
  },
  onOpenConversation: openConversation,
  onReadFile: async (path) => {
    const projectId = store?.snapshot?.conversation.projectId;
    if (!projectId) throw new Error("No project selected");
    return (await getFileContent(projectId, path)).text ?? "";
  },
  onOpenFile: (path, line) => {
    const projectId = store?.snapshot?.conversation.projectId;
    if (projectId) void act(() => openFilePane({ projectId, path, line }));
  },
  onPeekConversation: (id, title) => {
    peek = { id, title };
    peekOpen = true;
  },
  onLoadOlder: () => {
    if (store) void act(() => store!.loadOlder());
  },
  onContinueFromFailure: () => {
    if (store) void act(() => store!.control("continue"));
  },
  onResolve: async (id, resolution) => {
    await store?.resolve(id, resolution);
  },
  onForcePushQueuedPrompts: async () => {
    await store?.control("forcePush");
  },
  onDiscardQueuedPrompt: async (input) => {
    await store?.cancelInput(input.inputId);
  },
  onMoveQueuedPromptToComposer: async (input) => {
    const moved = await store?.moveInputToComposer(input.inputId);
    if (moved !== undefined) {
      text = moved;
      editTarget = undefined;
    }
  },
};
const menus: ConversationMenuBuilders = {
  transcriptMenu: (row, selectedText) => [
    {
      label: selectedText ? "Copy selection" : "Copy",
      onSelect: () =>
        void act(() =>
          writeClipboardText(
            selectedText ??
              (row.kind === "message"
                ? row.item.text
                : row.kind === "tool"
                  ? JSON.stringify(
                      {
                        arguments: row.toolCall.argsPreview,
                        result: row.toolCall.resultPreview,
                      },
                      null,
                      2,
                    )
                  : JSON.stringify(row.notice, null, 2)),
          ),
        ),
    },
  ],
};
const model = $derived<ConversationPaneModel>({
  conversationId,
  open: true,
  active,
  timeline: { prefix: rows, tail: [] },
  sending: store?.snapshot?.conversation.status === "running",
  streamingText: "",
  queuedPrompts: store?.snapshot?.queue ?? [],
  children: store?.snapshot?.children ?? [],
  parent,
  title: store?.snapshot?.conversation.title,
  error: actionError ?? store?.error,
  hasOlder: store?.hasOlder,
  loadingOlder: store?.loadingOlder,
  composer: {
    text,
    models: [],
    selectedModelKey: "",
    thinkingLevel: store?.snapshot?.config.reasoningLevel ?? "off",
    mode: store?.snapshot?.config.mode ?? "coding",
    permissionRuleSetId:
      store?.snapshot?.config.permissionRuleSetId ?? "autonomous",
    permissionRuleSets: [],
  },
});
</script>
<ConversationPane {model} {actions} {menus}>
  {#snippet composer()}{#if store}<WorkbenchComposerAdapter
        {store}
        {active}
        bind:text
        onOpenHistory={() => (historyOpen = true)}
        onSubmitText={submitPrompt}
        editing={Boolean(editTarget)}
        onCancelEdit={() => (editTarget = undefined)}
      />{/if}{/snippet}
</ConversationPane>
<SubagentTranscriptDialog
  bind:open={peekOpen}
  conversationId={peek?.id}
  label={peek?.title ?? "Child conversation"}
>
  {#if peekStore}<TranscriptList
      rows={peekRows}
      sending={peekStore.snapshot?.conversation.status === "running"}
      hasOlder={peekStore.hasOlder}
      loadingOlder={peekStore.loadingOlder}
      actions={{ onLoadOlder: () => void peekStore?.loadOlder() }}
    />{/if}
</SubagentTranscriptDialog>
{#if store}<ConversationHistoryDialog bind:open={historyOpen} {store} />{/if}
