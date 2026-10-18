<script lang="ts">
import { onDestroy, untrack, type Snippet } from "svelte";
import type { CapabilityPatch } from "@nervekit/contracts/capabilities";
import { isInlineCommandPrompt } from "@nervekit/contracts/completions";
import {
  listIntegrationHealth,
  listTools,
  uploadClipboardImage,
} from "$lib/api";
import type { AtlassianProfileHealth } from "@nervekit/contracts/auth";
import { getDesktopBridge } from "$lib/platform/desktop/desktop-bridge.svelte";
import { readClipboardText } from "$lib/platform/clipboard/read-text";
import { writeClipboardText } from "$lib/platform/clipboard/write-text";
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
import { resolveDroppedPaths } from "$lib/features/conversations/adapters/dropped-paths";
import { workbenchStartupState } from "$lib/application/startup/workbench-startup-state.svelte";
import {
  getCapabilityConfiguration,
  updateCapabilities,
} from "$lib/features/conversations/adapters/core-capabilities.adapter";
import { listAvailableSkills } from "$lib/features/skills/api/skills.api";
import { observeConversationChannel } from "$lib/application/startup/conversation-connection";
import { conversationCatalog } from "$lib/features/conversations/state/conversation-catalog.svelte";
import { onEvent } from "$lib/application/events/workbench-event-bus";
import {
  ComposerCapabilityController,
  canEditComposerDelegation,
  type ComposerCapabilityState,
} from "./composer-capability-controller";
import type { CapabilityToolGroup } from "$lib/presentation/composer/capability-tool-labels";
import ConversationToolSettingsDialog from "./ConversationToolSettingsDialog.svelte";
import ConversationProfilesHost from "./ConversationProfilesHost.svelte";
import type { CapabilitySubagentSlot } from "$lib/presentation/composer/capability-subagent-slot";
import { conversationProfileScope } from "./conversation-profile-controller";
import { bindComposerVoiceInput } from "./composer-voice-input";

let {
  activity,
  text = "",
  editorOverlay,
  modeHidden = false,
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
  mode = "coding",
  permissionRuleSetId = "autonomous",
  permissionRuleSets = [],
  permissionRuleSetsLoading = false,
  permissionRuleSetsError,
  slashCompletions = [],
  completionSource,
  fileCompletions,
  referenceCompletions,
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
  onModelChange,
  onThinkingLevelChange,
  onModeChange,
  onPermissionRuleSetChange,
  onRefreshPermissionRuleSets,
  onOpenPermissionSettings,
  onOpenCapabilitySettings,
}: PromptComposerProps & { activity?: Snippet } = $props();

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
let capabilityState = $state<ComposerCapabilityState>({
  skills: [],
  loading: false,
  mutating: false,
});
const capabilityController = new ComposerCapabilityController({
  getConfiguration: getCapabilityConfiguration,
  listSkills: listAvailableSkills,
  updateConfiguration: updateCapabilities,
  onStateChange: (state) => {
    capabilityState = state;
  },
});
const capabilityConfiguration = $derived(capabilityState.configuration);
const capabilitySkills = $derived(capabilityState.skills);
const capabilityLoading = $derived(
  capabilityState.loading || capabilityState.mutating,
);
const capabilityError = $derived(capabilityState.error);
const profileScope = $derived.by(() => {
  const pending = activePendingConversation;
  return conversationProfileScope(
    activeProject?.id,
    activeConversation,
    interactive,
    pending
      ? {
          pendingId: pending.id,
          document: pending.subagentProfileOverrides,
          lead: {
            model: pending.config.model,
            reasoningLevel: pending.config.reasoningLevel,
          },
          readonly: () => pending.sending,
          onDocumentChange: (document) => {
            pending.subagentProfileOverrides = document;
          },
        }
      : undefined,
  );
});
const capabilityScopeKey = $derived(
  `${activeProject?.id ?? "none"}:${activeConversation?.id ?? activePendingConversation?.id ?? "none"}:${interactive}`,
);
let capabilityProfileHealth = $state<AtlassianProfileHealth[]>([]);
/** Tool group whose conversation-level settings dialog is open. */
let configuringToolGroup = $state<CapabilityToolGroup | undefined>();

function refreshProfileHealth(): void {
  void listIntegrationHealth()
    .then((profiles) => {
      capabilityProfileHealth = profiles;
    })
    .catch(() => undefined);
}

$effect(() => {
  const progressive = workbenchStartupState.progressiveActive;
  const project = activeProject;
  const conversation = activeConversation;
  const pending = activePendingConversation;
  // A settings dialog belongs to the conversation it was opened for.
  configuringToolGroup = undefined;
  if (!progressive || !project) {
    capabilityController.setScope(undefined);
  } else if (conversation) {
    capabilityController.setScope({
      kind: "conversation",
      key: `project:${project.id}:conversation:${conversation.id}`,
      projectId: project.id,
      conversationId: conversation.id,
    });
  } else if (pending) {
    capabilityController.setScope({
      kind: "pending",
      key: `project:${project.id}:pending:${pending.id}`,
      projectId: project.id,
      pendingId: pending.id,
      overrides: pending.capabilityOverrides,
      onOverridesChange: (overrides) => {
        pending.capabilityOverrides = overrides;
      },
    });
  } else {
    capabilityController.setScope(undefined);
  }
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

onDestroy(() => capabilityController.setScope(undefined));

/* Project and user level changes made elsewhere must not leave the composer
 * showing a stale effective state. */
$effect(() => {
  const unsubscribes = [
    observeConversationChannel({
      recover: () => capabilityController.refresh(),
      disconnected() {},
      event() {},
      notice(notice) {
        if (notice.type !== "capabilities.changed") return;
        const data = notice.data;
        if (data.projectId !== activeProject?.id) return;
        if (
          data.conversationId !== undefined &&
          data.conversationId !== activeConversation?.id
        )
          return;
        void capabilityController.refresh();
      },
    }),
    onEvent("settings.updated", () => {
      void capabilityController.refresh();
    }),
    onEvent("auth.integration_health_changed", refreshProfileHealth),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
});

function patchCapabilities(patch: CapabilityPatch): Promise<void> {
  return capabilityController.patch(patch);
}

function resetCapabilities(): Promise<void> {
  return capabilityController.reset();
}

const micShortcut = getShortcutLabel("composer.toggleMic");
const micShortcutAria = getShortcutAriaLabel("composer.toggleMic");
const cancelMicShortcut = getShortcutLabel("composer.cancelMic");
const modeShortcut = getShortcutLabel("composer.toggleMode");
const modeShortcutAria = getShortcutAriaLabel("composer.toggleMode");
const modelShortcut = getShortcutLabel("composer.cycleModel");
const permissionShortcut = getShortcutLabel("composer.cyclePermission");
const permissionShortcutAria = getShortcutAriaLabel("composer.cyclePermission");
const thinkingShortcut = getShortcutLabel("composer.cycleThinking");
const stopShortcut = getShortcutLabel("composer.stopRun");
const stopShortcutAria = getShortcutAriaLabel("composer.stopRun");

const voiceTarget = $derived.by<VoiceInputTarget | undefined>(() => {
  if (activeConversation)
    return { kind: "conversation", id: activeConversation.id };
  if (activePendingConversation)
    return { kind: "pending-conversation", id: activePendingConversation.id };
  return undefined;
});
$effect(() => {
  const target = voiceTarget;
  if (!target) return;
  return bindComposerVoiceInput(voiceInputSession, target, {
    read: () => text,
    update: (next) => onChange?.(next),
    focus: () => {
      editorFocusToken += 1;
    },
  });
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

async function pasteImage(file: File): Promise<string> {
  return uploadClipboardImage(file);
}

async function dropFiles(files: readonly File[]): Promise<readonly string[]> {
  try {
    const bridge = getDesktopBridge();
    if (!bridge?.files || !activeProject) {
      throw new Error("Native file paths are unavailable in this window.");
    }
    return resolveDroppedPaths(
      files,
      activeProject.dir,
      bridge.files.getPathForFile,
    );
  } catch (caught) {
    const description =
      caught instanceof Error ? caught.message : String(caught);
    notify.error("Could not add dropped paths", { description });
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
const modeDisabled = $derived(
  !interactive || !(activeConversation || pendingConversationActive),
);
const capabilityDisabled = $derived(!availability.canConfigureRuntime);
const modelDisabled = $derived(capabilityDisabled || models.length === 0);
const modelRuntimeChangeHint = $derived(
  sending ? "Changes apply to the next model request" : undefined,
);

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

{#snippet capabilityProfiles(query: string, capability: CapabilitySubagentSlot)}
  <ConversationProfilesHost
    {capability}
    scope={profileScope}
    {query}
    unavailableReason={activeConversation
      ? "Sub-agents can't delegate; configure profiles in the lead conversation."
      : "Sub-agent profiles are unavailable for this conversation."}
  />
{/snippet}

<AgentComposer
  model={{
    text,
    editorOverlay,
    modeHidden,
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
    mode,
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
    modeDisabled,
    modelDisabled,
    capabilityDisabled,
    runtimeChangeHint: modelRuntimeChangeHint,
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
    modeShortcut,
    modeShortcutAria,
    modelShortcut,
    thinkingShortcut,
    todos,
    slashCompletions,
    completionSource,
    fileCompletions,
    referenceCompletions,
    capabilityConfiguration,
    capabilitySkills,
    capabilityLoading,
    capabilityError,
    capabilityProfiles,
    capabilityScopeKey,
    subagentControlsEnabled: canEditComposerDelegation(
      activeProject?.id,
      activeConversation,
      activePendingConversation,
      interactive,
    ),
    capabilities: {
      voice: true,
      imagePaste: true,
      fileDrop: fileDropSupported,
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
    onModelChange,
    onThinkingLevelChange,
    onModeChange,
    onPermissionRuleSetChange,
    onRefreshPermissionRuleSets,
    onOpenPermissionSettings,
    onOpenCapabilitySettings,
    onCapabilityPatch: (patch) => void patchCapabilities(patch),
    onConfigureCapabilityTool: (group) => {
      configuringToolGroup = group;
      refreshProfileHealth();
    },
    onResetCapabilities: () => void resetCapabilities(),
    onRefreshCapabilities: () => void capabilityController.refresh(),
    onPasteImage: pasteImage,
    onDropFiles: fileDropSupported ? dropFiles : undefined,
    onReadClipboardText: readClipboardText,
    onWriteClipboardText: writeClipboardText,
    onClipboardError: (action: "copy" | "cut" | "paste") =>
      notify.error(`Could not ${action} using the clipboard`),
  }}
>
  {#snippet header()}
    <div
      bind:this={headerEl}
      class="@container/conversation-activity mx-px flex min-w-0 items-start justify-between gap-2 px-2.5"
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
    <TranscriptionActivity
      {recording}
      {transcribing}
      elapsedMs={voiceInputSession.elapsedMs}
      maxDurationMs={voiceInputSession.maxDurationMs}
      retryAttempt={voiceTarget && voiceInputSession.isTargetActive(voiceTarget)
        ? voiceInputSession.retryAttempt
        : 0}
      maxRetries={voiceInputSession.maxRetries}
      class="composer-transcription-status"
    />
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
  profileHealth={capabilityProfileHealth}
  onPatch={(patch) => void patchCapabilities(patch)}
  onClose={() => (configuringToolGroup = undefined)}
/>
