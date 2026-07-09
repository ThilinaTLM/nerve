<script lang="ts">
  import Send from "@lucide/svelte/icons/send";
  import Square from "@lucide/svelte/icons/square";
  import type { Snippet } from "svelte";
  import { Button } from "@nervekit/shared-ui/components/ui/button";

  type Props = {
    /** Opaque mode string; only `"planning"` receives special surface styling. */
    mode: string;
    commandMode?: boolean;
    executableBlocks?: boolean;
    pendingApproval?: boolean;
    pendingQuestion?: boolean;
    pendingPlan?: boolean;
    showStop?: boolean;
    stopDisabled?: boolean;
    stopAriaLabel?: string;
    stopTitle?: string;
    stopShortcutAria?: string;
    submitDisabled: boolean;
    sendAriaLabel: string;
    sendTitle: string;
    onAbort?: () => void;
    onSubmit: () => void;
    /** Optional content above the surface (e.g. suggestion chips or a hint). */
    header?: Snippet;
    toolbar: Snippet;
    editor: Snippet;
    /** Optional controls left of the stop/send cluster (e.g. mic button). */
    sendLeading?: Snippet;
  };

  let {
    mode,
    commandMode = false,
    executableBlocks = false,
    pendingApproval = false,
    pendingQuestion = false,
    pendingPlan = false,
    showStop = false,
    stopDisabled = false,
    stopAriaLabel = "Stop generation",
    stopTitle = "Stop generation",
    stopShortcutAria,
    submitDisabled,
    sendAriaLabel,
    sendTitle,
    onAbort,
    onSubmit,
    header,
    toolbar,
    editor,
    sendLeading,
  }: Props = $props();
</script>

<form
  class="composer"
  data-pending-approval={pendingApproval ? "true" : undefined}
  data-pending-question={pendingQuestion ? "true" : undefined}
  data-pending-plan={pendingPlan ? "true" : undefined}
  onsubmit={(event) => {
    event.preventDefault();
    onSubmit();
  }}
>
  {#if header}
    {@render header()}
  {/if}

  <div
    class="composer-surface"
    data-mode={mode}
    data-command-mode={commandMode ? "true" : undefined}
    data-executable-blocks={executableBlocks ? "true" : undefined}
  >
    <div class="editor-shell">
      {@render toolbar()}
      {@render editor()}

      <div class="composer-send">
        {#if sendLeading}
          {@render sendLeading()}
        {/if}
        {#if showStop}
          <Button
            variant="destructive"
            size="icon-sm"
            class="stop-button"
            type="button"
            disabled={stopDisabled}
            onclick={onAbort}
            aria-label={stopAriaLabel}
            aria-keyshortcuts={stopShortcutAria}
            title={stopTitle}
          >
            <Square size={13} strokeWidth={2.5} />
          </Button>
        {/if}
        <Button
          size="icon-sm"
          class="send-button"
          type="submit"
          disabled={submitDisabled}
          aria-label={sendAriaLabel}
          title={sendTitle}
        >
          <Send size={14} strokeWidth={2.4} />
        </Button>
      </div>
    </div>
  </div>
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

  .composer-surface[data-command-mode="true"] {
    border-color: var(--info);
  }

  .composer-surface[data-command-mode="true"]:focus-within {
    border-color: var(--info);
    box-shadow: 0 0 0 1px color-mix(in oklab, var(--info) 40%, transparent);
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
</style>
