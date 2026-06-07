<script lang="ts">
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Mic from "@lucide/svelte/icons/mic";

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
  const progressDegrees = $derived(`${Math.round(progress * 360)}deg`);
  const nearLimit = $derived(progress >= 0.85);
  const statusText = $derived(
    recording
      ? `Recording ${elapsedLabel} of ${maxLabel}`
      : retryAttempt > 0
        ? `Retrying transcription ${retryAttempt}/${maxRetries}`
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
    style={`--progress: ${progressDegrees}`}
    aria-live="polite"
  >
    <span class="activity-orbit" aria-hidden="true">
      <span class="activity-ring"></span>
      <span class="activity-icon">
        {#if transcribing}
          <LoaderCircle size={13} strokeWidth={2.5} />
        {:else}
          <Mic size={13} strokeWidth={2.5} />
        {/if}
      </span>
    </span>
    <span class="activity-copy">
      <span class="activity-status">{statusText}</span>
      {#if recording}
        <span class="activity-timer">{elapsedLabel} / {maxLabel}</span>
      {/if}
    </span>
  </div>
{/if}

<style>
  .transcription-activity {
    --activity-accent: var(--info);
    position: absolute;
    right: 0;
    bottom: calc(100% + 0.45rem);
    z-index: 7;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    max-width: min(18rem, calc(100vw - 2rem));
    border: 1px solid color-mix(in oklab, var(--activity-accent) 34%, var(--border));
    border-radius: 999px;
    background: color-mix(in oklab, var(--card) 92%, transparent);
    color: var(--foreground);
    padding: 0.32rem 0.58rem 0.32rem 0.38rem;
    box-shadow:
      0 10px 26px color-mix(in oklab, var(--foreground) 10%, transparent),
      0 0 0 1px color-mix(in oklab, var(--background) 70%, transparent) inset;
    backdrop-filter: blur(12px);
    transform-origin: 100% 100%;
    animation: activity-enter 140ms ease-out;
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

  .activity-orbit {
    position: relative;
    display: grid;
    place-items: center;
    width: 1.72rem;
    height: 1.72rem;
    flex: 0 0 auto;
    border-radius: 999px;
    background: conic-gradient(
      var(--activity-accent) var(--progress),
      color-mix(in oklab, var(--muted-foreground) 18%, transparent) 0
    );
  }

  .activity-ring {
    position: absolute;
    inset: -0.18rem;
    border: 1px solid color-mix(in oklab, var(--activity-accent) 36%, transparent);
    border-radius: inherit;
    opacity: 0.7;
    animation: activity-pulse 1.45s ease-out infinite;
  }

  .activity-icon {
    position: relative;
    display: grid;
    place-items: center;
    width: 1.28rem;
    height: 1.28rem;
    border-radius: inherit;
    background: var(--card);
    color: var(--activity-accent);
  }

  .transcription-activity[data-state="transcribing"] .activity-icon :global(svg) {
    animation: activity-spin 900ms linear infinite;
  }

  .activity-copy {
    display: grid;
    gap: 0.02rem;
    min-width: 0;
  }

  .activity-status {
    overflow: hidden;
    max-width: 12rem;
    color: var(--foreground);
    font-size: var(--text-xs);
    font-weight: 600;
    line-height: 1.05;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activity-timer {
    color: var(--muted-foreground);
    font-size: 0.67rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.05;
  }

  @keyframes activity-enter {
    from {
      opacity: 0;
      transform: translateY(0.25rem) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes activity-pulse {
    0% {
      opacity: 0.65;
      transform: scale(0.9);
    }
    70%,
    100% {
      opacity: 0;
      transform: scale(1.45);
    }
  }

  @keyframes activity-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .transcription-activity,
    .activity-ring,
    .transcription-activity[data-state="transcribing"] .activity-icon :global(svg) {
      animation: none;
    }
  }
</style>
