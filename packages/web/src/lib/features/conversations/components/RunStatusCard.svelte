<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { StatusDot } from "$lib/components/ui/status-dot";
  import type { RunStatusNotice } from "$lib/core/types/state-types";

  type Props = {
    notice: RunStatusNotice;
    isLast: boolean;
    sending: boolean;
    onContinueFromFailure?: (statusEntryId: string) => void;
  };

  let {
    notice,
    isLast,
    sending,
    onContinueFromFailure,
  }: Props = $props();

  let now = $state(Date.now());

  $effect(() => {
    if (notice.state !== "retrying" || !notice.retryAt) return;
    now = Date.now();
    const interval = setInterval(() => {
      now = Date.now();
    }, 250);
    return () => clearInterval(interval);
  });

  const canContinue = $derived(
    notice.state === "retry_exhausted" &&
      isLast &&
      !sending &&
      notice.retryable === true &&
      Boolean(notice.entryId) &&
      Boolean(onContinueFromFailure),
  );

  const dotTone = $derived(notice.state === "retrying" ? "running" : "warn");
  const headerText = $derived(
    notice.state === "retrying" ? "model request" : "request failed",
  );

  const retrySeconds = $derived.by(() => {
    const retryAtMs = notice.retryAt ? Date.parse(notice.retryAt) : NaN;
    if (Number.isFinite(retryAtMs)) {
      return Math.max(0, Math.ceil((retryAtMs - now) / 1000));
    }
    if (typeof notice.delayMs === "number" && notice.delayMs > 0) {
      return Math.ceil(notice.delayMs / 1000);
    }
    return undefined;
  });

  const failureText = $derived(
    notice.errorMessage?.trim() ? notice.errorMessage.trim() : undefined,
  );

  const attemptText = $derived(
    typeof notice.attempt === "number" && typeof notice.maxRetries === "number"
      ? `attempt ${notice.attempt}/${notice.maxRetries}`
      : typeof notice.attempt === "number"
        ? `attempt ${notice.attempt}`
        : undefined,
  );

  const bodyText = $derived.by(() => {
    const failure = failureText
      ? `Request failed with ${failureText}`
      : "Request failed";
    if (notice.state !== "retrying") {
      return `${failure}. Click Continue to retry.`;
    }
    const retry =
      typeof retrySeconds === "number"
        ? retrySeconds > 0
          ? `retry in ${retrySeconds}s`
          : "retrying now"
        : "retrying soon";
    const attempt = attemptText ? ` (${attemptText})` : "";
    return `${failure}, ${retry}${attempt}`;
  });

  function continueFromFailure() {
    if (!notice.entryId || !canContinue) return;
    onContinueFromFailure?.(notice.entryId);
  }
</script>

<article class={`run-status-line state-${notice.state}`} aria-live="polite">
  <div class="run-status-header">
    <StatusDot tone={dotTone} pulse={notice.state === "retrying"} size="xs" />
    <span class="badge">retrying</span>
    <span class="arg">{headerText}</span>
  </div>

  <p class="status-summary">{bodyText}</p>

  {#if canContinue}
    <div class="status-actions">
      <Button size="sm" variant="default" onclick={continueFromFailure}>
        Continue
      </Button>
    </div>
  {/if}
</article>

<style>
  .run-status-line {
    display: grid;
    gap: 0.55rem;
    width: 100%;
    padding: 0.6rem 0.75rem;
  }

  .run-status-header {
    min-width: 0;
    line-height: 1.5;
  }

  .run-status-header :global(span[aria-hidden]) {
    margin-right: 0.4rem;
    vertical-align: middle;
  }

  .badge {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: 650;
    color: var(--foreground);
  }

  .arg {
    margin-left: 0.5rem;
    color: var(--muted-foreground);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .status-summary {
    margin: 0;
    color: var(--muted-foreground);
    font-size: var(--text-sm);
  }

  .status-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: end;
    gap: 0.5rem;
  }
</style>
