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
    --activity-accent: var(--info);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2rem;
    max-width: 9rem;
    border: 1px solid color-mix(in oklab, var(--activity-accent) 28%, var(--border));
    border-radius: 999px;
    background: color-mix(in oklab, var(--activity-accent) 10%, var(--card));
    color: var(--activity-accent);
    padding: 0 0.52rem;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    line-height: 1;
    white-space: nowrap;
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--background) 64%, transparent) inset;
    animation: activity-enter 120ms ease-out;
  }

  .transcription-activity[data-state="recording"] {
    --activity-accent: var(--destructive);
  }

  .transcription-activity[data-state="transcribing"] {
    --activity-accent: var(--info);
  }

  .transcription-activity[data-near-limit="true"] {
    --activity-accent: var(--warning);
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
