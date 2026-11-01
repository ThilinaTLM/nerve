<script lang="ts">
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question-mark";
import SquareTerminal from "@lucide/svelte/icons/square-terminal";
import Square from "@lucide/svelte/icons/square";
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cubicOut } from "svelte/easing";

type Props = {
  /** Active profile name; only `"planning"` receives special surface styling. */
  agentProfile: string;
  commandMode?: boolean;
  executableBlocks?: boolean;
  pendingApproval?: boolean;
  pendingQuestion?: boolean;
  pendingPlan?: boolean;
  showStop?: boolean;
  stopping?: boolean;
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
  /** Scrolls the transcript to the pending ask-user question card. */
  onGoToQuestion?: () => void;
};

let {
  agentProfile,
  commandMode = false,
  executableBlocks = false,
  pendingApproval = false,
  pendingQuestion = false,
  pendingPlan = false,
  showStop = false,
  stopping = false,
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
  onGoToQuestion,
}: Props = $props();

/** The stop button grows into the send cluster (and collapses out of it) so
 * the mic and send buttons slide instead of jumping. */
function revealAction(node: HTMLElement) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const width = node.offsetWidth;
  return {
    duration: reduced ? 0 : 180,
    easing: cubicOut,
    css: (t: number) =>
      `width:${t * width}px;opacity:${t};transform:scale(${0.6 + 0.4 * t});overflow:hidden;`,
  };
}
</script>

<form
  class="composer"
  data-tour-id="composer"
  data-composer-popup-anchor
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
    data-profile={agentProfile}
    data-command-mode={commandMode ? "true" : undefined}
    data-executable-blocks={executableBlocks ? "true" : undefined}
  >
    {#if pendingQuestion}
      <div
        class="flex items-center gap-2 px-3 pt-2 text-ui text-info"
        role="status"
      >
        <MessageCircleQuestion class="size-3.5 flex-none" aria-hidden="true" />
        <span class="min-w-0 truncate"
          >The agent is waiting for your answer</span
        >
        {#if onGoToQuestion}
          <Button
            variant="outline"
            size="sm"
            type="button"
            class="ml-auto"
            onclick={onGoToQuestion}>Go to question</Button
          >
        {/if}
      </div>
    {:else if commandMode}
      <div class="flex items-center gap-1.5 px-3 pt-2 text-ui text-warning">
        <SquareTerminal class="size-3.5 flex-none" aria-hidden="true" />
        <span class="min-w-0 truncate"
          >Shell command — runs locally, not sent to the agent</span
        >
      </div>
    {/if}

    <div class="editor-shell">
      {@render editor()}
    </div>

    <div
      class="@container/composer-toolbar flex items-center gap-0.5 px-1.5 pb-1.5"
      data-tour-id="composer-controls"
    >
      {@render toolbar()}
      <span class="mx-0.5 h-4 w-px flex-none bg-border" aria-hidden="true"
      ></span>
      <div
        class="flex flex-none items-center gap-0.5"
        data-tour-id="composer-send-actions"
      >
        {#if sendLeading}
          {@render sendLeading()}
        {/if}
        {#if showStop}
          <span class="inline-flex flex-none" transition:revealAction>
            <Button
              variant="destructive"
              size="icon"
              type="button"
              disabled={stopDisabled || stopping}
              onclick={onAbort}
              aria-label={stopping ? "Stopping generation" : stopAriaLabel}
              aria-keyshortcuts={stopShortcutAria}
              title={stopping ? "Stopping generation" : stopTitle}
            >
              {#if stopping}
                <Spinner />
              {:else}
                <Square />
              {/if}
            </Button>
          </span>
        {/if}
        <Button
          size="icon"
          type="submit"
          disabled={submitDisabled}
          aria-label={sendAriaLabel}
          title={sendTitle}
        >
          {#if commandMode}<SquareTerminal />{:else}<ArrowUp />{/if}
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
  /* Card, suggestion chips and activity island share the transcript content
   * column: its inset (viewport + row padding) and scrollbar lane come from
   * ConversationPaneLayout; standalone uses fall back to a plain inset. */
  padding-block: 0.65rem;
  padding-inline-start: var(--conversation-content-inset, 0.65rem);
  padding-inline-end: calc(
    var(--conversation-content-inset, 0.65rem) +
      var(--conversation-scrollbar-lane, 0px)
  );
}

/* One card: notice, text, then the single bottom toolbar. Nothing floats on
 * the border, so the suggestion popup has a clean edge to sit on. */
.composer-surface {
  position: relative;
  overflow: visible;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--card);
  --well: var(--well-on-card);
  box-shadow: var(--shadow-sm);
  transition:
    border-color 120ms ease,
    box-shadow 120ms ease;
}

.composer-surface:focus-within {
  border-color: var(--ring);
}

.composer-surface[data-profile="planning"],
.composer-surface[data-profile="planning"]:focus-within {
  border-color: var(--info);
}

.composer-surface[data-command-mode="true"],
.composer-surface[data-command-mode="true"]:focus-within {
  border-color: var(--warning);
}

.composer[data-pending-question="true"] .composer-surface {
  border-color: var(--info);
}

.composer[data-pending-approval="true"] .composer-surface,
.composer[data-pending-plan="true"] .composer-surface {
  border-color: var(--warning);
}

.editor-shell {
  position: relative;
  min-width: 0;
}

.editor-shell :global(.composer-editor),
.editor-shell :global(.composer-editor:focus-within) {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
</style>
