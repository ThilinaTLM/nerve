<script lang="ts">
import { editableCapabilityResets } from "$lib/domain/capabilities/editable-resets";
import { agentProfileCatalog } from "$lib/application/agent-profiles/agent-profile-catalog.svelte";
import { parseSlashCommand } from "@nervekit/contracts/completions";
import { onDestroy, untrack, type Snippet } from "svelte";
import { DEFAULT_AGENT_PROFILE } from "@nervekit/contracts/agent-profiles";
import { type LeadSettingsOverrides } from "@nervekit/contracts/agent-configuration";
import type { ComposerView } from "$lib/application/composer/composer-view.svelte";
import type { AgentEditorView } from "$lib/presentation/composer/agent-editor-view";
import type { AvailableSkill } from "@nervekit/contracts/skills";
import { isInlineCommandPrompt } from "@nervekit/contracts/completions";
import { listTools, uploadAttachment } from "$lib/api";
import { getDesktopBridge } from "$lib/platform/desktop/desktop-bridge.svelte";
import { readClipboardText } from "$lib/platform/clipboard/read-text";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
import { newConversationInProject } from "$lib/application/workspace/workspace-actions.svelte";
import { handleComposerCompletionAction } from "./composer-completion-actions";
import type { ComposerCompletionAction } from "$lib/presentation/composer/composer-editor-completions";
import { notify } from "$lib/application/notifications/notify.svelte";
import TranscriptionActivity from "$lib/features/conversations/audio/TranscriptionActivity.svelte";
import {
  voiceInputSession,
  type VoiceInputTarget,
} from "$lib/features/conversations/audio/voice-input-session.svelte";
import { AgentComposer } from "$lib/presentation/conversations";
import VoiceMicButton from "$lib/presentation/composer/VoiceMicButton.svelte";
import {
  AudioInputAuthRequiredDialog,
  chatGptAudioAuth,
} from "$lib/features/audio";
import PromptSuggestionChips from "$lib/features/conversations/views/PromptSuggestionChips.svelte";
import {
  getShortcutAriaLabel,
  getShortcutLabel,
} from "$lib/application/commands/command-registry";
import type { PromptComposerProps } from "$lib/features/conversations/views/prompt-composer-props";
import { deriveComposerAvailability } from "$lib/features/conversations/adapters/composer-availability";
import { resolveDroppedFiles } from "./dropped-files";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import { listAvailableSkills } from "$lib/features/skills/api/skills.api";
import { conversationCatalog } from "$lib/features/conversations/state/conversation-catalog.svelte";
import type { CapabilityToolGroup } from "$lib/presentation/composer/capability-tool-labels";
import ConversationToolSettingsDialog from "./ConversationToolSettingsDialog.svelte";
import type { ComposerEditorApi } from "$lib/presentation/composer/composer-editor-api";
import { ComposerDictationBridge } from "$lib/presentation/composer/composer-dictation-bridge";
import { bindComposerVoiceInput } from "./composer-voice-input";

let {
  composerView,
  activity,
  text = "",
  editorOverlay,
  session,
  contextActions,
  activeProject,
  activeConversation,
  activePendingConversation,
  pendingConversationActive = false,
  approvals = [],
  pendingUserQuestions = [],
  pendingPlanReviews = [],
  interactive = true,
  sending = false,
  teamRunning = false,
  stopping = false,
  compacting = false,
  models = [],
  selectedModelKey = "",
  contextUsage,
  conversationUsage,
  agentUsage,
  agentUsageLoading,
  agentUsageError,
  contextWindow = 0,
  todos = [],
  focusToken = 0,
  composerEscapeToken = 0,
  micShortcutToken = 0,
  thinkingLevel = "off",
  agentProfile = DEFAULT_AGENT_PROFILE,
  agentProfiles = [],
  lockedFields,
  settingsDiffers,
  profileDisabled = false,
  permissionRuleSetId = "autonomous",
  permissionRuleSets = [],
  permissionRuleSetsLoading = false,
  permissionRuleSetsError,
  slashCompletions = [],
  completionSource,
  composerSuggestions = [],
  onSendSuggestion,
  onDraftSuggestion,
  onChange,
  onSubmit,
  onAbort,
  onCompact,
  onUsageOpenChange,
  onUsageRetry,
  onOpenSystemPrompt,
  onModelSelectionChange,
  onResetPermission,
  onAgentProfileChange,
  onPermissionRuleSetChange,
  onRefreshPermissionRuleSets,
  onOpenPermissionSettings,
  onOpenCapabilitySettings,
}: PromptComposerProps & {
  activity?: Snippet;
  composerView?: ComposerView;
} = $props();

let headerEl = $state<HTMLDivElement>();
let activityWidth = $state(0);
$effect(() => {
  const element = headerEl;
  if (!element) return;
  const update = () => {
    const style = getComputedStyle(element);
    activityWidth = Math.max(
      0,
      element.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
    );
  };
  const observer = new ResizeObserver(update);
  update();
  observer.observe(element);
  return () => observer.disconnect();
});

// A newly created pending conversation opens directly into its first prompt,
// so its editor should be ready for typing as soon as it mounts.
let editorFocusToken = $state(
  untrack(() => (pendingConversationActive ? 1 : 0)),
);
let voiceSubmitPending = $state(false);
let lastFocusToken: number | undefined;
let lastComposerEscapeToken: number | undefined;
let lastMicShortcutToken: number | undefined;
let audioAuthDialogOpen = $state(false);
let capabilitySkills = $state<AvailableSkill[]>([]);
let capabilityError = $state<string>();
let capabilityLoading = $state(false);
let capabilityRefreshGeneration = 0;
let configuringToolGroup = $state<CapabilityToolGroup | undefined>();
const capabilityScopeKey = $derived(
  JSON.stringify([
    activeProject?.id,
    activeConversation?.id ?? activePendingConversation?.id,
    activePendingConversation?.explicitAgentProfile,
  ]),
);
const capabilityConfiguration = $derived<AgentEditorView | undefined>(
  composerView?.resolution
    ? {
        resolution: composerView.resolution,
        overrides: composerView.overrides,
        role: "lead",
      }
    : undefined,
);
const capabilitySubagentProfiles = $derived(
  agentProfileCatalog
    .profiles(activeProject?.id)
    .filter((p) => p.usableBy !== "lead")
    .map((p) => ({
      name: p.name,
      label: p.label,
      whenToUse: p.whenToUse,
      defaultEnabled: p.defaultEnabled,
      error: p.error,
    })),
);
async function refreshCapabilities() {
  const conversation = activeConversation;
  const pending = activePendingConversation;
  if (
    !workbenchStartupState.progressiveActive ||
    !activeProject ||
    (!conversation && !pending)
  )
    return;
  const generation = ++capabilityRefreshGeneration;
  const projectId = activeProject.id;
  capabilityLoading = true;
  try {
    const result = await listAvailableSkills(projectId);
    if (generation === capabilityRefreshGeneration)
      capabilitySkills = result.skills;
  } catch (error) {
    if (generation !== capabilityRefreshGeneration) return;
    capabilityError = error instanceof Error ? error.message : String(error);
  } finally {
    if (generation === capabilityRefreshGeneration) capabilityLoading = false;
  }
}
$effect(() => {
  if (!workbenchStartupState.progressiveActive) return;
  void capabilityScopeKey;
  // Only a scope change resets the view. Refresh reads pending preferences
  // synchronously; tracking those reads would clear the view on every toggle.
  untrack(() => {
    capabilityRefreshGeneration += 1;
    capabilitySkills = [];
    capabilityError = undefined;
    configuringToolGroup = undefined;
    void refreshCapabilities();
  });
});
$effect(() => {
  if (!workbenchStartupState.progressiveActive || !activeProject) return;
  void listTools()
    .then((tools) => {
      conversationCatalog.toolRisks = Object.fromEntries(
        tools.map((tool) => [tool.name, tool.risk]),
      );
    })
    .catch(() => undefined);
});
async function patchCapabilities(
  changes: LeadSettingsOverrides,
  resets: string[] = [],
) {
  await composerView?.patchCapabilities(changes, resets);
}

function resetCapabilities() {
  if (!capabilityConfiguration) return;
  const resets = editableCapabilityResets(
    capabilityConfiguration.overrides,
    capabilityConfiguration.resolution,
  );
  if (resets.length) return patchCapabilities({}, resets);
}

const micShortcut = getShortcutLabel("composer.toggleMic");
const micShortcutAria = getShortcutAriaLabel("composer.toggleMic");
const cancelMicShortcut = getShortcutLabel("composer.cancelMic");
const profileShortcut = getShortcutLabel("composer.cycleProfile");
const profileShortcutAria = getShortcutAriaLabel("composer.cycleProfile");
const permissionShortcut = getShortcutLabel("composer.cyclePermission");
const permissionShortcutAria = getShortcutAriaLabel("composer.cyclePermission");
const stopShortcut = getShortcutLabel("composer.stopRun");
const stopShortcutAria = getShortcutAriaLabel("composer.stopRun");

const voiceTarget = $derived.by<VoiceInputTarget | undefined>(() => {
  if (activeConversation)
    return { kind: "conversation", id: activeConversation.id };
  if (activePendingConversation)
    return { kind: "pending-conversation", id: activePendingConversation.id };
  return undefined;
});
let editorApi = $state<ComposerEditorApi>();
const dictation = new ComposerDictationBridge(
  () => editorApi,
  () => {
    if (voiceTarget) void voiceInputSession.cancel(voiceTarget);
  },
);
$effect(() => {
  const target = voiceTarget;
  if (!target) return;
  return bindComposerVoiceInput(
    voiceInputSession,
    target,
    {
      read: () => text,
      update: (next) => onChange?.(next),
      focus: () => {
        editorFocusToken += 1;
      },
    },
    {
      chip: dictation,
      notifyError: (message) =>
        notify.error("Voice input failed", { description: message }),
    },
  );
});

const recording = $derived(
  Boolean(
    voiceTarget &&
    voiceInputSession.isTargetActive(voiceTarget) &&
    voiceInputSession.recording,
  ),
);
const transcribing = $derived(
  Boolean(
    voiceTarget &&
    voiceInputSession.isTargetActive(voiceTarget) &&
    voiceInputSession.transcribing,
  ),
);
const voiceBusyElsewhere = $derived(
  Boolean(voiceTarget && voiceInputSession.isBusyForOtherTarget(voiceTarget)),
);

$effect(() => {
  const state = {
    recording,
    transcribing,
    elapsedMs: recording || transcribing ? voiceInputSession.elapsedMs : 0,
  };
  untrack(() => dictation.sync(state));
});
onDestroy(() => dictation.discard());

const pendingApproval = $derived(approvals.length > 0);
const pendingQuestion = $derived(pendingUserQuestions.length > 0);
const pendingPlan = $derived(pendingPlanReviews.length > 0);
const blockedForReview = $derived(
  pendingApproval || pendingQuestion || pendingPlan,
);
const commandMode = $derived(isInlineCommandPrompt(text));
const availability = $derived(
  deriveComposerAvailability({
    interactive,
    hasProject: Boolean(activeProject),
    hasConversation: Boolean(activeConversation || pendingConversationActive),
    hasModels: models.length > 0,
    blockedForReview,
    compacting,
    stopping,
    sending,
    commandMode,
    voiceSubmitPending,
  }),
);
const canPrompt = $derived(availability.canPrompt);
const editorDisabled = $derived(!availability.canEdit);
const submitDisabled = $derived(!availability.canSubmit);
const chatGptAudioConfigured = $derived(chatGptAudioAuth.configured);
const fileDropSupported = $derived(Boolean(getDesktopBridge()?.files));
const supportsAudioRecording = $derived(voiceInputSession.isSupported());
const micDisabled = $derived(
  !transcribing &&
    (Boolean(editorOverlay) ||
      !interactive ||
      stopping ||
      !voiceTarget ||
      voiceInputSession.pending ||
      (!recording &&
        (!canPrompt || !supportsAudioRecording || voiceBusyElsewhere))),
);
const micTitle = $derived(
  transcribing
    ? `Cancel transcription${cancelMicShortcut ? ` (${cancelMicShortcut})` : " (Esc)"}${voiceInputSession.retryAttempt > 0 ? ` — retry ${voiceInputSession.retryAttempt}/${voiceInputSession.maxRetries}` : ""}`
    : recording
      ? `Stop recording${micShortcut ? ` (${micShortcut})` : ""} — ${cancelMicShortcut ?? "Esc"} to cancel; right-click to cancel (${formatElapsed(voiceInputSession.elapsedMs)} / ${formatElapsed(voiceInputSession.maxDurationMs)})`
      : voiceBusyElsewhere
        ? "Voice recording is active in another conversation"
        : !chatGptAudioConfigured
          ? "Connect ChatGPT to use voice input"
          : micShortcut
            ? `Record voice prompt (${micShortcut})`
            : "Record voice prompt",
);
const sendAriaLabel = $derived(
  voiceSubmitPending
    ? "Transcribing and sending prompt"
    : recording
      ? "Transcribe and send prompt"
      : compacting
        ? "Compacting context"
        : availability.canEdit && models.length === 0
          ? "Waiting for an available model"
          : commandMode
            ? "Run command"
            : sending
              ? "Queue prompt"
              : "Send prompt",
);
const sendTitle = $derived(
  voiceSubmitPending
    ? "Transcribing audio, then sending prompt"
    : recording
      ? "Stop recording, transcribe, and send prompt"
      : compacting
        ? "Compacting context"
        : availability.canEdit && models.length === 0
          ? "Models are loading; you can continue drafting"
          : commandMode
            ? sending
              ? "Wait for the current agent turn before running a command"
              : "Run command"
            : sending
              ? "Queue prompt for the next agent turn"
              : "Send prompt",
);

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

async function submitComposer() {
  if (!availability.canSubmit) return;

  if (recording && voiceTarget) {
    voiceSubmitPending = true;
    try {
      const transcribed = await voiceInputSession.stop(voiceTarget);
      if (transcribed) onSubmit?.();
    } finally {
      voiceSubmitPending = false;
    }
    return;
  }

  onSubmit?.();
}

function runSlashCommand(name: string): void {
  const command = parseSlashCommand(`/${name}`);
  switch (command?.name) {
    case "plan":
      onAgentProfileChange?.("planning");
      break;
    case "compact":
      onCompact?.();
      break;
    case "abort":
      onAbort?.();
      break;
    case "new":
      if (activeProject) newConversationInProject(activeProject.dir);
      break;
    case "profile":
      onAgentProfileChange?.(command.profile);
  }
}

function handleCompletionAction(action: ComposerCompletionAction): void {
  handleComposerCompletionAction(action, (page) =>
    onOpenCapabilitySettings?.(page),
  );
}

async function pasteImage(file: File): Promise<string> {
  return uploadAttachment(file);
}

async function dropFiles(files: readonly File[]): Promise<readonly string[]> {
  try {
    const bridge = getDesktopBridge();
    return await resolveDroppedFiles(files, {
      getPathForFile: bridge?.files?.getPathForFile,
      projectDir: activeProject?.dir,
      upload: uploadAttachment,
      notifyError: (title, description) => notify.error(title, { description }),
      notifyInfo: (message) => notify.message(message),
    });
  } catch (caught) {
    const description =
      caught instanceof Error ? caught.message : String(caught);
    notify.error("Could not add dropped paths", { description });
    throw caught;
  }
}

/** Attach button: images upload; other files use the native path when the
 * desktop bridge offers one, otherwise the generic attachment upload. */
async function attachFile(file: File): Promise<string> {
  try {
    if (!file.type.startsWith("image/") && fileDropSupported) {
      const [path] = await dropFiles([file]);
      if (path) return path;
    }
    return await uploadAttachment(file);
  } catch (caught) {
    const description =
      caught instanceof Error ? caught.message : String(caught);
    notify.error(`Could not attach ${file.name || "file"}`, { description });
    throw caught;
  }
}

const controlsDisabled = $derived(
  !interactive ||
    !(activeConversation || pendingConversationActive) ||
    stopping ||
    compacting ||
    blockedForReview,
);
const selectorDisabled = $derived(
  profileDisabled ||
    !interactive ||
    !(activeConversation || pendingConversationActive),
);
const capabilityDisabled = $derived(!availability.canConfigureRuntime);
const modelDisabled = $derived(capabilityDisabled || models.length === 0);

function toggleRecording() {
  if (transcribing && voiceTarget) {
    void voiceInputSession.cancel(voiceTarget);
    return;
  }
  if (!interactive || micDisabled || compacting || stopping || !voiceTarget)
    return;
  if (!recording && !chatGptAudioConfigured) {
    audioAuthDialogOpen = true;
    return;
  }
  void voiceInputSession.toggle(voiceTarget);
}

function cancelRecordingShortcut() {
  if (dictation.failed) {
    dictation.discard();
    return true;
  }
  if ((!recording && !transcribing) || !voiceTarget) return false;
  void voiceInputSession.cancel(voiceTarget);
  return true;
}

$effect(() => {
  if (lastFocusToken === undefined || !interactive) {
    lastFocusToken = focusToken;
    return;
  }
  if (focusToken === lastFocusToken) return;
  lastFocusToken = focusToken;
  editorFocusToken += 1;
});

$effect(() => {
  if (
    lastComposerEscapeToken === undefined ||
    (!interactive && !transcribing)
  ) {
    lastComposerEscapeToken = composerEscapeToken;
    return;
  }
  if (composerEscapeToken === lastComposerEscapeToken) return;
  lastComposerEscapeToken = composerEscapeToken;
  if (!cancelRecordingShortcut()) editorFocusToken += 1;
});

$effect(() => {
  if (lastMicShortcutToken === undefined || (!interactive && !transcribing)) {
    lastMicShortcutToken = micShortcutToken;
    return;
  }
  if (micShortcutToken === lastMicShortcutToken) return;
  lastMicShortcutToken = micShortcutToken;
  toggleRecording();
});

function handleMicContextMenu(event: MouseEvent) {
  if ((!recording && !transcribing) || !voiceTarget) return;
  event.preventDefault();
  void voiceInputSession.cancel(voiceTarget);
}
</script>

<AgentComposer
  model={{
    text,
    editorOverlay,
    session,
    contextActions,
    disabled: editorDisabled,
    editorDisabled,
    submitDisabled,
    sending,
    stopping,
    compacting,
    showStop: sending || stopping || compacting || teamRunning,
    pendingApproval,
    pendingQuestion,
    pendingPlan,
    models,
    selectedModelKey,
    thinkingLevel,
    agentProfile,
    agentProfiles,
    lockedFields,
    settingsDiffers,
    permissionRuleSetId,
    permissionRuleSets,
    permissionRuleSetsLoading,
    permissionRuleSetsError,
    contextUsage,
    conversationUsage,
    agentUsage,
    agentUsageLoading,
    agentUsageError,
    contextWindow,
    placeholder: pendingApproval
      ? "Approval required before the agent can continue"
      : pendingPlan
        ? "Review the plan in the transcript before the agent can continue"
        : pendingQuestion
          ? "Reply in the transcript before the agent can continue"
          : compacting
            ? "Compacting context…"
            : sending
              ? "Queue a prompt for the next agent turn"
              : "Ask the local Nerve agent",
    focusToken: editorFocusToken,
    controlsDisabled,
    profileDisabled: selectorDisabled,
    modelDisabled,
    capabilityDisabled,
    sendAriaLabel,
    sendTitle,
    stopAriaLabel: compacting ? "Stop compaction" : "Stop generation",
    stopShortcutAria,
    stopTitle: stopping
      ? compacting
        ? "Stopping compaction"
        : "Stopping generation"
      : compacting
        ? stopShortcut
          ? `Stop compaction (${stopShortcut})`
          : "Stop compaction"
        : stopShortcut
          ? `Stop generation (${stopShortcut})`
          : "Stop generation",
    permissionShortcut,
    permissionShortcutAria,
    profileShortcut,
    profileShortcutAria,
    todos,
    slashCompletions,
    completionSource,
    capabilityConfiguration,
    capabilitySkills,
    capabilityLoading:
      capabilityLoading ||
      composerView?.status === "loading" ||
      composerView?.saving,
    capabilityError: composerView?.error ?? capabilityError,
    capabilityScopeKey,
    capabilitySubagentProfiles,
    subagentControlsEnabled:
      interactive && !activeConversation?.parentConversationId,
    capabilities: {
      voice: true,
      imagePaste: true,
      fileDrop: true,
      completions: true,
      suggestions: true,
      shortcuts: true,
      todos: true,
      queueing: true,
    },
  }}
  actions={{
    onComposerChange: onChange,
    onSubmit: submitComposer,
    onAbort,
    onCompact,
    onUsageOpenChange,
    onUsageRetry,
    onOpenSystemPrompt,
    onModelSelectionChange,
    onResetPermission,
    onAgentProfileChange,
    onPermissionRuleSetChange,
    onRefreshPermissionRuleSets,
    onOpenPermissionSettings,
    onOpenCapabilitySettings,
    onCapabilityPatch: (patch, resets) => void patchCapabilities(patch, resets),
    onConfigureCapabilityTool: (group) => {
      configuringToolGroup = group;
    },
    onResetCapabilities: () => void resetCapabilities(),
    onRefreshCapabilities: () => void refreshCapabilities(),
    onPasteImage: pasteImage,
    onDropFiles: dropFiles,
    onAttachFile: attachFile,
    onSlashCommand: runSlashCommand,
    onCompletionAction: handleCompletionAction,
    onEditorReady: (api) => (editorApi = api),
    onReadClipboardText: readClipboardText,
    onWriteClipboardText: writeClipboardText,
    onClipboardError: (action: "copy" | "cut" | "paste") =>
      notify.error(`Could not ${action} using the clipboard`),
  }}
>
  {#snippet header()}
    <div
      bind:this={headerEl}
      class="@container/conversation-activity flex min-w-0 items-start justify-between gap-2"
      style:--conversation-activity-width={`${activityWidth}px`}
    >
      <div class="min-w-0 flex-1 overflow-hidden">
        {#if composerSuggestions.length > 0 && !blockedForReview && !compacting && canPrompt}
          <PromptSuggestionChips
            suggestions={composerSuggestions}
            disabled={sending}
            onSend={onSendSuggestion}
            onDraft={onDraftSuggestion}
          />
        {/if}
      </div>
      {#if activity}
        <div class="relative -translate-y-1.5 shrink-0">
          {@render activity()}
        </div>
      {/if}
    </div>
  {/snippet}

  {#snippet sendLeading()}
    {#if !editorApi}
      <TranscriptionActivity
        {recording}
        {transcribing}
        elapsedMs={voiceInputSession.elapsedMs}
        maxDurationMs={voiceInputSession.maxDurationMs}
        retryAttempt={voiceTarget &&
        voiceInputSession.isTargetActive(voiceTarget)
          ? voiceInputSession.retryAttempt
          : 0}
        maxRetries={voiceInputSession.maxRetries}
        class="composer-transcription-status"
      />
    {/if}
    <VoiceMicButton
      {recording}
      {transcribing}
      disabled={micDisabled}
      title={micTitle}
      idleLabel={chatGptAudioConfigured
        ? "Record voice prompt"
        : "Connect ChatGPT to use voice input"}
      shortcutAria={micShortcutAria}
      onToggle={toggleRecording}
      onContextMenu={handleMicContextMenu}
    />
  {/snippet}
</AgentComposer>

<AudioInputAuthRequiredDialog bind:open={audioAuthDialogOpen} />

<ConversationToolSettingsDialog
  configuration={capabilityConfiguration}
  group={configuringToolGroup}
  projectId={activeProject?.id}
  onPatch={(patch, resets) => void patchCapabilities(patch, resets)}
  onClose={() => (configuringToolGroup = undefined)}
/>
