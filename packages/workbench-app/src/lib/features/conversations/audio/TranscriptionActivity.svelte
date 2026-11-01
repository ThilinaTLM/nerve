<script lang="ts">
type Props = {
  recording?: boolean;
  transcribing?: boolean;
  elapsedMs?: number;
  maxDurationMs?: number;
  retryAttempt?: number;
  maxRetries?: number;
  class?: string;
};

let {
  recording = false,
  transcribing = false,
  elapsedMs = 0,
  maxDurationMs = 1,
  retryAttempt = 0,
  maxRetries = 0,
  class: className = "",
}: Props = $props();

const visible = $derived(recording || transcribing);
const elapsedLabel = $derived(formatElapsed(elapsedMs));
const maxLabel = $derived(formatElapsed(maxDurationMs));
const progress = $derived(
  Math.max(0, Math.min(1, maxDurationMs > 0 ? elapsedMs / maxDurationMs : 0)),
);
const nearLimit = $derived(progress >= 0.85);
const visualText = $derived(
  recording
    ? `${elapsedLabel} / ${maxLabel}`
    : retryAttempt > 0
      ? `Retry ${retryAttempt}/${maxRetries}`
      : "Transcribing…",
);
const ariaLabel = $derived(
  recording
    ? `Recording ${elapsedLabel} of ${maxLabel}`
    : retryAttempt > 0
      ? `Retrying transcription ${retryAttempt} of ${maxRetries}`
      : "Transcribing audio",
);

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
</script>

{#if visible}
  <div
    class={`transcription-activity ${className}`}
    data-state={recording ? "recording" : "transcribing"}
    data-near-limit={nearLimit ? "true" : undefined}
    aria-live="polite"
  >
    <span class="activity-sr">{ariaLabel}</span>
    <span aria-hidden="true">{visualText}</span>
  </div>
{/if}

<style>
.transcription-activity {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Sits inline with the `icon` mic button, so it tracks the shared control
   * height instead of carrying its own. */
  height: var(--spacing-control);
  border-radius: var(--radius-md);
  max-width: 9rem;
  border: 1px solid var(--info-strong);
  background: var(--info-subtle);
  color: var(--info);
  padding: 0 0.52rem;
  font-family: var(--font-mono);
  font-size: var(--text-ui);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  animation: activity-enter 120ms ease-out;
}

.transcription-activity[data-state="recording"] {
  border-color: var(--destructive-strong);
  background: var(--destructive-subtle);
  color: var(--destructive);
}

.transcription-activity[data-near-limit="true"] {
  border-color: var(--warning-strong);
  background: var(--warning-subtle);
  color: var(--warning);
}

.activity-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  clip-path: inset(50%);
}
</style>
