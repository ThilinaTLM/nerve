<script lang="ts">
import {
  fileCompletions,
  referenceCompletions,
} from "./composer-reference-completions";
import { untrack } from "svelte";
import { composerSignals } from "$lib/features/conversations/state/composer-signals.svelte";
import Mic from "@lucide/svelte/icons/mic";
import { voiceInputSession } from "$lib/features/conversations/audio/voice-input-session.svelte";
import { appendTranscriptText } from "$lib/features/conversations/audio/voice-input-target";
import TranscriptionActivity from "$lib/features/conversations/audio/TranscriptionActivity.svelte";
import {
  AudioInputAuthRequiredDialog,
  chatGptAudioAuth,
} from "$lib/features/audio";
import { uploadClipboardImage } from "$lib/features/filesystem";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import { requestConversation } from "$lib/application/startup/conversation-connection";
import type { ConversationStore } from "$lib/features/conversations/state/core-conversation-store.svelte";
import { AgentComposer } from "$lib/presentation/conversations";
import type {
  ConversationComposerModel,
  ConversationPaneActions,
} from "$lib/presentation/conversations/conversation-view-contracts";
import type { ModelInfo } from "@nervekit/contracts/models";
import type { PermissionRuleSetSummary } from "@nervekit/contracts/permissions";
import type { CompletionItem } from "@nervekit/contracts/completions";
import { modelKey, parseModelKey } from "$lib/presentation/utils/model";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Checkbox } from "@nervekit/ui-kit/components/ui/checkbox";
import { readClipboardText } from "$lib/platform/clipboard/read-text";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
let {
  store,
  active = true,
  text = $bindable(""),
  onOpenHistory,
  onSubmitText,
  editing = false,
  onCancelEdit,
}: {
  store: ConversationStore;
  active?: boolean;
  text?: string;
  onOpenHistory?: () => void;
  onSubmitText?: (text: string) => Promise<unknown>;
  editing?: boolean;
  onCancelEdit?: () => void;
} = $props();
let models = $state<ModelInfo[]>([]);
let ruleSets = $state<PermissionRuleSetSummary[]>([]);
let completions = $state<CompletionItem[]>([]);
let error = $state<string>();
let submitting = $state(false);
let capabilityOpen = $state(false);
let tools = $state<{ name: string; description?: string }[]>([]);
let skills = $state<{ name: string; description?: string }[]>([]);
let lastMicToken = untrack(() => composerSignals.micToken);
$effect(() => {
  const token = composerSignals.micToken;
  const changed = token !== lastMicToken;
  lastMicToken = token;
  if (changed && active) void toggleVoice();
});
const config = $derived(store.snapshot?.config);
let audioAuthOpen = $state(false);
const voiceTarget = $derived({
  kind: "conversation" as const,
  id: store.conversationId,
});
const recording = $derived(
  voiceInputSession.isTargetActive(voiceTarget) && voiceInputSession.recording,
);
const transcribing = $derived(
  voiceInputSession.isTargetActive(voiceTarget) &&
    voiceInputSession.transcribing,
);
$effect(() => {
  const target = voiceTarget;
  const release = voiceInputSession.registerTargetHandlers(target, {
    appendTranscript: (transcript) =>
      (text = appendTranscriptText(text, transcript)),
    onError: (message) => (error = message),
  });
  return () => {
    release();
    void voiceInputSession.cancelIfTarget(target);
  };
});
async function toggleVoice() {
  if (!chatGptAudioAuth.configured) {
    audioAuthOpen = true;
    return;
  }
  await act(() => voiceInputSession.toggle(voiceTarget));
}

async function act(fn: () => Promise<unknown>) {
  error = undefined;
  try {
    await fn();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
}
async function loadCatalogs() {
  const [m, p, c, t, s] = await Promise.all([
    requestConversation("model.list", {}),
    requestConversation("permissionRuleSet.list", {}),
    requestConversation("completion.slash.list", {}),
    requestConversation("tool.list", {}),
    requestConversation("skill.list", {
      projectId: store.snapshot?.conversation.projectId,
    }),
  ]);
  models = m.models;
  ruleSets = p.ruleSets.map((rule) => ({
    id: rule.id,
    name: rule.name,
    source: rule.source,
    enabled: rule.enabled,
    available: rule.enabled,
    description: rule.description,
  }));
  completions = c.items;
  tools = t.tools;
  skills = s.skills;
}
$effect(() => {
  const projectId = store.snapshot?.conversation.projectId;
  if (!projectId) return;
  void act(loadCatalogs);
  const offSettings = onEvent("settings.updated", () => void act(loadCatalogs));
  const offAuth = onEvent(
    "auth.integration_health_changed",
    () => void act(loadCatalogs),
  );
  return () => {
    offSettings();
    offAuth();
  };
});
async function toggle(
  kind: "enabledTools" | "enabledSkills",
  name: string,
  checked: boolean,
) {
  const catalog = kind === "enabledTools" ? tools : skills;
  const enabled = config?.[kind] ?? catalog.map((item) => item.name);
  await act(() =>
    store.configure({
      [kind]: checked
        ? [...new Set([...enabled, name])]
        : enabled.filter((value) => value !== name),
    }),
  );
}
const model = $derived<ConversationComposerModel>({
  text,
  focusToken: active ? composerSignals.focusToken : 0,
  models,
  selectedModelKey: config ? modelKey(config.model) : "",
  thinkingLevel: config?.reasoningLevel ?? "off",
  mode: config?.mode ?? "coding",
  permissionRuleSetId: config?.permissionRuleSetId ?? "autonomous",
  permissionRuleSets: ruleSets,
  slashCompletions: completions,
  fileCompletions: (query) =>
    fileCompletions(store.snapshot?.conversation.projectId, query),
  referenceCompletions: (kind, query) =>
    referenceCompletions(store.snapshot?.conversation.projectId, kind, query),
  sending: store.snapshot?.conversation.status === "running",
  showStop:
    store.snapshot?.conversation.status === "running" ||
    store.snapshot?.conversation.status === "waiting",
  disabled: !store.connected,
  submitDisabled: !store.connected || submitting,
  controlsDisabled: !store.connected,
  modelDisabled: !store.connected || models.length === 0,
  pendingApproval: store.snapshot?.toolCalls.some(
    (call) => call.state === "awaiting_approval",
  ),
  pendingQuestion: store.snapshot?.toolCalls.some(
    (call) => call.interaction?.kind === "user_input",
  ),
  pendingPlan: store.snapshot?.toolCalls.some(
    (call) => call.interaction?.kind === "plan_review",
  ),
});
const actions: ConversationPaneActions = {
  onComposerChange: (value) => (text = value),
  onSubmit: () => {
    const submitted = text;
    if (!submitted.trim() || submitting) return;
    submitting = true;
    void act(async () => {
      try {
        if (onSubmitText) await onSubmitText(submitted);
        else {
          await store.submit(submitted);
          if (text === submitted) text = "";
        }
      } finally {
        submitting = false;
      }
    });
  },
  onAbort: () => void act(() => store.control("stop")),
  onCompact: () => void act(() => store.control("compact")),
  onModelChange: (value) => {
    const model = parseModelKey(value);
    if (model) void act(() => store.configure({ model }));
  },
  onThinkingLevelChange: (reasoningLevel) =>
    void act(() => store.configure({ reasoningLevel })),
  onModeChange: (mode) => void act(() => store.configure({ mode })),
  onPermissionRuleSetChange: (permissionRuleSetId) =>
    void act(() => store.configure({ permissionRuleSetId })),
  onRefreshPermissionRuleSets: () => void act(loadCatalogs),
  onOpenCapabilitySettings: () => (capabilityOpen = true),
  onPasteImage: uploadClipboardImage,
  onReadClipboardText: readClipboardText,
  onWriteClipboardText: writeClipboardText,
};
</script>
<AgentComposer {model} {actions}>
  {#snippet header()}
    {#if editing}<div
        class="flex items-center justify-between gap-2 text-xs text-muted-foreground"
      >
        <span>Editing earlier message · sending creates a new branch</span
        ><Button
          variant="ghost"
          size="xs"
          disabled={submitting}
          onclick={onCancelEdit}>Cancel edit</Button
        >
      </div>{/if}
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs text-destructive" role="alert">{error ?? ""}</span>
      <div class="flex gap-1">
        <Button
          variant="ghost"
          size="xs"
          onclick={() => (capabilityOpen = true)}>Tools & skills</Button
        ><Button variant="ghost" size="xs" onclick={onOpenHistory}
          >History</Button
        >
      </div>
    </div>{/snippet}
  {#snippet sendLeading()}<TranscriptionActivity
      {recording}
      {transcribing}
      elapsedMs={voiceInputSession.elapsedMs}
      maxDurationMs={voiceInputSession.maxDurationMs}
      retryAttempt={voiceInputSession.retryAttempt}
      maxRetries={voiceInputSession.maxRetries}
    /><Button
      variant="ghost"
      size="icon-sm"
      aria-label={recording ? "Stop recording" : "Record voice prompt"}
      disabled={transcribing ||
        voiceInputSession.isBusyForOtherTarget(voiceTarget)}
      onclick={toggleVoice}><Mic size={14} /></Button
    >{/snippet}
</AgentComposer>
<AudioInputAuthRequiredDialog bind:open={audioAuthOpen} />
<DialogShell
  bind:open={capabilityOpen}
  title="Conversation tools and skills"
  description="Changes apply to the next model request."
>
  <div class="max-h-96 space-y-4 overflow-y-auto">
    <div>
      <h3 class="mb-2 text-sm font-semibold">Tools</h3>
      {#each tools as tool (tool.name)}<label
          class="flex items-center gap-2 py-1 text-sm"
          ><Checkbox
            checked={config?.enabledTools === null ||
              config?.enabledTools.includes(tool.name)}
            onCheckedChange={(checked) =>
              toggle("enabledTools", tool.name, checked === true)}
          />{tool.name}</label
        >{/each}
    </div>
    <div>
      <h3 class="mb-2 text-sm font-semibold">Skills</h3>
      {#each skills as skill (skill.name)}<label
          class="flex items-center gap-2 py-1 text-sm"
          ><Checkbox
            checked={config?.enabledSkills === null ||
              config?.enabledSkills.includes(skill.name)}
            onCheckedChange={(checked) =>
              toggle("enabledSkills", skill.name, checked === true)}
          />{skill.name}</label
        >{/each}
    </div>
  </div>
</DialogShell>
