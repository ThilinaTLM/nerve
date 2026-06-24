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
    notice.state !== "retrying" &&
      isLast &&
      !sending &&
      notice.retryable === true &&
      Boolean(notice.entryId) &&
      Boolean(onContinueFromFailure),
  );

  const dotTone = $derived(notice.state === "retrying" ? "running" : "warn");
  const badgeText = $derived(notice.state === "retrying" ? "retrying" : "run");
  const headerText = $derived.by(() => {
    switch (notice.state) {
      case "retrying":
        return "model request";
      case "interrupted":
        return "interrupted";
      default:
        return "failed";
    }
  });

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
    if (notice.state === "retrying") {
      const failure = failureText
        ? `Request failed with ${failureText}`
        : "Request failed";
      const retry =
        typeof retrySeconds === "number"
          ? retrySeconds > 0
            ? `retry in ${retrySeconds}s`
            : "retrying now"
          : "retrying soon";
      const attempt = attemptText ? ` (${attemptText})` : "";
      return `${failure}, ${retry}${attempt}`;
    }
    if (notice.state === "interrupted") {
      const lead = failureText ?? "The run was interrupted.";
      return `${lead} Click Continue to resume.`;
    }
    const failure = failureText
      ? `Request failed with ${failureText}`
      : "Request failed";
    return `${failure}. Click Continue to retry.`;
  });

  function continueFromFailure() {
    if (!notice.entryId || !canContinue) return;
    onContinueFromFailure?.(notice.entryId);
  }
</script>

<article class={`run-status-line state-${notice.state}`} aria-live="polite">
  <div class="run-status-header">
    <StatusDot tone={dotTone} pulse={notice.state === "retrying"} size="xs" class="mr-1.5 align-middle" />
    <span class="badge">{badgeText}</span>
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
