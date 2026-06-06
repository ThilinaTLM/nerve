<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Lock from "@lucide/svelte/icons/lock";
  import Mic from "@lucide/svelte/icons/mic";
  import Send from "@lucide/svelte/icons/send";
  import Shield from "@lucide/svelte/icons/shield";
  import Square from "@lucide/svelte/icons/square";
  import Zap from "@lucide/svelte/icons/zap";
  import {
    transcribeAudio,
    uploadClipboardImage,
    type AgentRecord,
    type ApprovalWithToolCall,
    type CompletionItem,
    type ContextUsage,
    type ModelInfo,
    type PlanReviewRecord,
    type ProjectRecord,
    type SessionRecord,
    type UserQuestionRecord,
  } from "../../api";
  import CodeMirrorComposer from "../../CodeMirrorComposer.svelte";
  import { Button } from "$lib/components/ui/button";
  import Popover from "$lib/components/ui/popover-panel";
  import ApprovalStrip from "./ApprovalStrip.svelte";
  import ComposerModelPicker from "./ComposerModelPicker.svelte";
  import ContextProgressBadge from "./ContextProgressBadge.svelte";
  import type { Component } from "svelte";

  type Mode = AgentRecord["mode"];
  type PermissionLevel = AgentRecord["permissionLevel"];
  type ThinkingLevel = AgentRecord["thinkingLevel"];

  type Props = {
    text?: string;
    activeProject?: ProjectRecord;
    activeSession?: SessionRecord;
    approvals?: ApprovalWithToolCall[];
    pendingUserQuestion?: UserQuestionRecord;
    pendingPlanReview?: PlanReviewRecord;
    live?: boolean;
    sending?: boolean;
    error?: string;
    models?: ModelInfo[];
    selectedModelKey?: string;
    contextUsage?: ContextUsage;
    contextWindow?: number;
    thinkingLevel?: ThinkingLevel;
    mode?: Mode;
    permissionLevel?: PermissionLevel;
    slashCompletions?: CompletionItem[];
    fileCompletions?: (query: string) => Promise<CompletionItem[]>;
    onChange?: (value: string) => void;
    onSubmit?: () => void;
    onAbort?: () => void;
    onModelChange?: (value: string) => void;
    onThinkingLevelChange?: (value: ThinkingLevel) => void;
    onModeChange?: (value: Mode) => void;
    onPermissionChange?: (value: PermissionLevel) => void;
    onGrantApproval?: (id: string) => void;
    onDenyApproval?: (id: string) => void;
  };

  let {
    text = "",
    activeProject,
    activeSession,
    approvals = [],
    pendingUserQuestion,
    pendingPlanReview,
    live = false,
    sending = false,
    error,
    models = [],
    selectedModelKey = "",
    contextUsage,
    contextWindow = 0,
    thinkingLevel = "off",
    mode = "coding",
    permissionLevel = "autonomous",
    slashCompletions = [],
    fileCompletions,
    onChange,
    onSubmit,
    onAbort,
    onModelChange,
    onThinkingLevelChange,
    onModeChange,
    onPermissionChange,
    onGrantApproval,
    onDenyApproval,
  }: Props = $props();

  let recording = $state(false);
  let transcribing = $state(false);
  let audioError = $state<string | undefined>();
  let mediaRecorder: MediaRecorder | undefined;
  let audioStream: MediaStream | undefined;
  let recordedChunks: Blob[] = [];
  let recordingStartedAt = 0;

  const pendingApproval = $derived(approvals.length > 0);
  const pendingQuestion = $derived(Boolean(pendingUserQuestion));
  const pendingPlan = $derived(Boolean(pendingPlanReview));
  const blockedForReview = $derived(pendingApproval || pendingQuestion || pendingPlan);
  const canPrompt = $derived(Boolean(activeProject && activeSession && live && models.length > 0 && !blockedForReview));
  const editorDisabled = $derived(sending || !canPrompt);
  const submitDisabled = $derived(!canPrompt);
  const supportsAudioRecording = $derived(
    typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== "undefined",
  );
  const micDisabled = $derived(
    transcribing || (!recording && (!canPrompt || sending || !supportsAudioRecording)),
  );
  const displayedError = $derived(error ?? audioError);

  function submitComposer() {
    if (!blockedForReview) onSubmit?.();
  }

  async function pasteImage(file: File): Promise<string> {
    return uploadClipboardImage(file);
  }

  const controlsDisabled = $derived(!activeSession || sending || blockedForReview);
  const modeDisabled = $derived(!activeSession);
  const modelDisabled = $derived(controlsDisabled || models.length === 0);

  const modeLabel = $derived(mode === "planning" ? "Planning" : "Coding");

  function toggleMode() {
    onModeChange?.(mode === "coding" ? "planning" : "coding");
  }

  type PermissionOption = {
    value: PermissionLevel;
    label: string;
    detail: string;
    icon: Component;
  };

  const permissionOptions: PermissionOption[] = [
    { value: "read_only", label: "Read only", detail: "No writes or mutating commands", icon: Lock },
    { value: "supervised", label: "Supervised", detail: "Ask before non-read tool calls", icon: Shield },
    { value: "autonomous", label: "Autonomous", detail: "Allow tool calls without approval", icon: Zap },
  ];

  const activePermission = $derived(
    permissionOptions.find((option) => option.value === permissionLevel) ?? permissionOptions[2],
  );

  let permissionOpen = $state(false);

  function selectPermission(value: PermissionLevel) {
    if (value !== permissionLevel) onPermissionChange?.(value);
    permissionOpen = false;
  }

  function preferredRecordingMimeType(): string | undefined {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/wav",
    ];
    return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  }

  function stopAudioTracks() {
    audioStream?.getTracks().forEach((track) => track.stop());
    audioStream = undefined;
  }

  function appendTranscript(transcript: string) {
    const trimmed = transcript.trim();
    if (!trimmed) return;
    const separator = text.trim() ? (/[\s\n]$/.test(text) ? "" : "\n\n") : "";
    onChange?.(`${text}${separator}${trimmed}`);
  }

  async function finishRecording(mimeType: string | undefined) {
    const chunks = recordedChunks;
    const durationMs = Math.max(1, Date.now() - recordingStartedAt);
    recordedChunks = [];
    mediaRecorder = undefined;
    recording = false;
    stopAudioTracks();

    if (chunks.length === 0) {
      audioError = "No audio was captured.";
      return;
    }

    const blobType = mimeType || chunks.find((chunk) => chunk.type)?.type || "audio/webm";
    const audio = new Blob(chunks, { type: blobType });
    transcribing = true;
    audioError = undefined;
    try {
      appendTranscript(await transcribeAudio(audio, durationMs));
    } catch (err) {
      audioError = err instanceof Error ? err.message : String(err);
    } finally {
      transcribing = false;
    }
  }

  async function startRecording() {
    if (!supportsAudioRecording) {
      audioError = "Audio recording is not supported in this browser.";
      return;
    }
    audioError = undefined;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = preferredRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordedChunks = [];
      audioStream = stream;
      mediaRecorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.push(event.data);
      };
      recorder.onerror = (event) => {
        audioError = event.error?.message || "Audio recording failed.";
        stopAudioTracks();
        recording = false;
      };
      recorder.onstop = () => {
        void finishRecording(recorder.mimeType || mimeType);
      };
      recordingStartedAt = Date.now();
      recording = true;
      recorder.start();
    } catch (err) {
      stopAudioTracks();
      mediaRecorder = undefined;
      recording = false;
      audioError = err instanceof Error ? err.message : String(err);
    }
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === "inactive") return;
    mediaRecorder.stop();
  }

  function toggleRecording() {
    if (recording) {
      stopRecording();
    } else {
      void startRecording();
    }
  }
</script>

<form class="composer" data-pending-approval={pendingApproval ? "true" : undefined} data-pending-question={pendingQuestion ? "true" : undefined} data-pending-plan={pendingPlan ? "true" : undefined} onsubmit={(event) => { event.preventDefault(); submitComposer(); }}>
  <ApprovalStrip {approvals} {onGrantApproval} {onDenyApproval} />

  <div class="composer-surface" data-mode={mode}>
    <div class="editor-shell">
      <div class="composer-tabs">
        <Popover
          bind:open={permissionOpen}
          class="permission-popover-content"
          triggerClass="composer-tab permission-tab"
          ariaLabel="Permission level"
          side="top"
          align="start"
          sideOffset={9}
        >
          {#snippet trigger()}
            {@const Icon = activePermission.icon}
            <span class="permission-tab-inner" class:disabled={controlsDisabled} title={`Permission: ${activePermission.label}`}>
              <Icon size={13} strokeWidth={2.2} />
            </span>
          {/snippet}
          <div class="permission-menu">
            <p class="permission-heading">Permission level</p>
            <ul class="permission-list">
              {#each permissionOptions as option (option.value)}
                {@const ActiveIcon = option.icon}
                <li>
                  <button type="button" class="permission-row" class:active={option.value === permissionLevel} aria-pressed={option.value === permissionLevel} onclick={() => selectPermission(option.value)}>
                    <ActiveIcon size={15} strokeWidth={2.1} />
                    <span class="permission-row-text">
                      <span class="permission-row-label">{option.label}</span>
                      <span class="permission-row-detail">{option.detail}</span>
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        </Popover>

        <button type="button" class="composer-tab mode-tab" disabled={modeDisabled} title={`Mode: ${modeLabel} (click to switch)`} onclick={toggleMode}>
          {modeLabel}
        </button>

        <ContextProgressBadge {contextUsage} {contextWindow} />

        <ComposerModelPicker
          {models}
          {selectedModelKey}
          {thinkingLevel}
          disabled={modelDisabled}
          {onModelChange}
          {onThinkingLevelChange}
        />
      </div>

      <CodeMirrorComposer
        value={text}
        disabled={editorDisabled}
        placeholder={pendingApproval ? "Approval required before the agent can continue…" : pendingPlan ? "Review the plan in the transcript before the agent can continue…" : pendingQuestion ? "Reply in the transcript before the agent can continue…" : "Ask the local Nerve agent…"}
        {slashCompletions}
        {fileCompletions}
        onChange={onChange}
        onSubmit={submitComposer}
        onPasteImage={pasteImage}
      />

      <div class="composer-send">
        <Button
          variant={recording ? "destructive" : "secondary"}
          size="icon-sm"
          class={`mic-button${recording ? " recording" : ""}`}
          type="button"
          disabled={micDisabled}
          onclick={toggleRecording}
          aria-label={recording ? "Stop recording" : "Record voice prompt"}
          title={recording ? "Stop recording" : transcribing ? "Transcribing audio…" : "Record voice prompt"}
        >
          {#if transcribing}
            <LoaderCircle size={14} strokeWidth={2.4} class="spin" />
          {:else}
            <Mic size={14} strokeWidth={2.4} />
          {/if}
        </Button>
        {#if sending && !pendingQuestion}
          <Button variant="secondary" size="icon-sm" class="stop-button" onclick={onAbort} aria-label="Stop generation" title="Stop generation">
            <Square size={13} strokeWidth={2.5} />
          </Button>
        {:else}
          <Button size="icon-sm" class="send-button" type="submit" disabled={submitDisabled} aria-label="Send prompt" title="Send prompt">
            <Send size={14} strokeWidth={2.4} />
          </Button>
        {/if}
      </div>
    </div>
  </div>

  {#if displayedError}<p class="composer-error">{displayedError}</p>{/if}
</form>

<style>
  .composer {
    display: grid;
    gap: 0.55rem;
    background: transparent;
    padding: 0.65rem;
  }

  .composer-surface {
    position: relative;
    margin-top: 0.55rem;
    overflow: visible;
    border: 1px solid var(--input);
    border-radius: var(--radius-md);
    background: var(--background);
    box-shadow:
      0 1px 0 color-mix(in oklab, var(--foreground) 4%, transparent) inset,
      var(--shadow-sm);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease;
  }

  .composer-surface:focus-within {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--ring) 35%, transparent);
  }

  .composer-surface[data-mode="planning"] {
    border-color: var(--success);
  }

  .composer-surface[data-mode="planning"]:focus-within {
    border-color: var(--success);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--success) 35%, transparent);
  }

  .composer[data-pending-approval="true"] .composer-surface,
  .composer[data-pending-question="true"] .composer-surface,
  .composer[data-pending-plan="true"] .composer-surface {
    border-color: var(--warning);
  }

  .composer[data-pending-approval="true"] .composer-surface:focus-within,
  .composer[data-pending-question="true"] .composer-surface:focus-within,
  .composer[data-pending-plan="true"] .composer-surface:focus-within {
    border-color: var(--warning);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--warning) 45%, transparent);
  }

  .editor-shell {
    position: relative;
    min-width: 0;
  }

  .composer-tabs {
    position: absolute;
    z-index: 4;
    top: 0;
    left: 0.65rem;
    right: 0.65rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    transform: translateY(-50%);
    pointer-events: none;
  }

  .composer-tabs > :global(*) {
    pointer-events: auto;
  }

  .composer-tabs :global(.context-usage-tab) {
    margin-left: auto;
  }

  :global(.composer-tab) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    height: 1.55rem;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--card);
    color: var(--muted-foreground);
    padding: 0 0.6rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    box-shadow: var(--shadow-sm);
    transition:
      color 120ms ease,
      border-color 120ms ease,
      background 120ms ease;
  }

  :global(.composer-tab:hover:not(:disabled)) {
    border-color: color-mix(in oklab, var(--primary) 40%, var(--border));
    background: var(--accent);
    color: var(--foreground);
  }

  :global(.composer-tab:disabled) {
    opacity: 0.55;
    cursor: default;
  }

  :global(.composer-tab[data-state="open"]) {
    border-color: var(--primary);
    background: var(--accent);
    color: var(--foreground);
  }

  :global(.permission-tab) {
    width: 1.7rem;
    padding: 0;
  }

  .permission-tab-inner {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .permission-tab-inner.disabled {
    opacity: 0.6;
  }

  .permission-menu {
    display: grid;
    gap: 0.45rem;
    padding: 0.6rem;
  }

  .permission-heading {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .permission-list {
    display: grid;
    gap: 0.15rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .permission-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--foreground);
    padding: 0.4rem 0.5rem;
    text-align: left;
    cursor: pointer;
  }

  .permission-row:hover {
    background: var(--accent);
  }

  .permission-row.active {
    border-color: color-mix(in oklab, var(--primary) 35%, transparent);
    background: color-mix(in oklab, var(--primary) 12%, transparent);
    color: var(--primary);
  }

  .permission-row-text {
    display: grid;
    gap: 0.05rem;
    min-width: 0;
  }

  .permission-row-label {
    font-size: var(--text-sm);
    font-weight: 500;
  }

  .permission-row-detail {
    color: var(--muted-foreground);
    font-size: var(--text-xs);
  }

  .permission-row.active .permission-row-detail {
    color: color-mix(in oklab, var(--primary) 75%, var(--muted-foreground));
  }

  .editor-shell :global(.composer-editor) {
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .editor-shell :global(.composer-editor:focus-within) {
    box-shadow: none;
  }

  .composer-send {
    position: absolute;
    right: 0.5rem;
    bottom: 0.5rem;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  :global(.send-button),
  :global(.stop-button),
  :global(.mic-button) {
    border-radius: 999px;
  }

  :global(.send-button) {
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--primary-foreground) 18%, transparent) inset;
  }

  :global(.mic-button.recording) {
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--destructive) 28%, transparent) inset;
  }

  :global(.spin) {
    animation: composer-spin 900ms linear infinite;
  }

  @keyframes composer-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .composer-error {
    margin: 0;
    border: 1px solid color-mix(in oklab, var(--destructive) 16%, transparent);
    border-radius: var(--radius-sm);
    background: color-mix(in oklab, var(--destructive) 16%, transparent);
    color: var(--destructive);
    padding: 0.42rem 0.5rem;
    font-size: var(--text-xs);
  }
</style>
