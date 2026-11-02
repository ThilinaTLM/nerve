<script lang="ts">
import ArrowUp from "@lucide/svelte/icons/arrow-up";
import MessageCircleQuestion from "@lucide/svelte/icons/message-circle-question-mark";
import Plus from "@lucide/svelte/icons/plus";
import SquareTerminal from "@lucide/svelte/icons/square-terminal";
import Square from "@lucide/svelte/icons/square";
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

/**
 * Phone counterpart of `ComposerShell`: a bar docked to the bottom edge
 * instead of a floating card. The editor spans the full width, the toolbar
 * and send cluster sit in one thumb-reach row underneath, and attaching is a
 * visible button because phones have no drag and drop. Send and stop keep
 * focus in the editor, so the keyboard stays up between prompts.
 */
type Props = {
  /** Active profile name; only `"planning"` receives special styling. */
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
  /** Content above the bar (suggestion chips, activity, a hint). */
  header?: Snippet;
  toolbar: Snippet;
  editor: Snippet;
  /** Controls left of the stop/send cluster (e.g. mic button). */
  sendLeading?: Snippet;
  onGoToQuestion?: () => void;
  onAttachFiles?: (files: File[]) => void;
  attachDisabled?: boolean;
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
  onAttachFiles,
  attachDisabled = false,
}: Props = $props();

const tone = $derived(
  pendingApproval || pendingPlan || commandMode
    ? "warning"
    : pendingQuestion || agentProfile === "planning"
      ? "info"
      : undefined,
);

let fileInput = $state<HTMLInputElement | null>(null);

/** Tapping a button would otherwise blur the editor and drop the keyboard. */
function keepEditorFocus(event: MouseEvent): void {
  event.preventDefault();
}
</script>

<form
  class="grid min-w-0 gap-2"
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
    <div class="min-w-0 px-(--conversation-content-inset,1rem)">
      {@render header()}
    </div>
  {/if}

  <div
    class="mobile-composer-dock grid min-w-0 border-t bg-panel"
    data-tone={tone}
    data-executable-blocks={executableBlocks ? "true" : undefined}
  >
    {#if pendingQuestion}
      <div
        class="flex items-center gap-2 px-3 pt-2 text-ui text-info"
        role="status"
      >
        <MessageCircleQuestion class="size-4 flex-none" aria-hidden="true" />
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
        <SquareTerminal class="size-4 flex-none" aria-hidden="true" />
        <span class="min-w-0 truncate">Shell command, runs locally</span>
      </div>
    {/if}

    <div class="editor-shell min-w-0 px-1">
      {@render editor()}
    </div>

    <div class="flex min-w-0 items-center gap-1 px-1.5">
      {#if onAttachFiles}
        <input
          bind:this={fileInput}
          type="file"
          multiple
          class="hidden"
          tabindex="-1"
          aria-hidden="true"
          onchange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            if (files.length) onAttachFiles(files);
            event.currentTarget.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          type="button"
          disabled={attachDisabled}
          ariaLabel="Attach photos or files"
          data-tour-id="composer-attach"
          onclick={() => fileInput?.click()}
        >
          <Plus />
        </Button>
      {/if}
      <div
        class="@container/composer-toolbar flex min-w-0 flex-1 items-center gap-0.5"
        data-tour-id="composer-controls"
      >
        {@render toolbar()}
      </div>
      <div
        class="flex flex-none items-center gap-1"
        data-tour-id="composer-send-actions"
      >
        {#if sendLeading}
          {@render sendLeading()}
        {/if}
        {#if showStop}
          <Button
            variant="destructive"
            size="icon"
            type="button"
            disabled={stopDisabled || stopping}
            onmousedown={keepEditorFocus}
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
        {/if}
        <Button
          size="icon"
          type="submit"
          disabled={submitDisabled}
          onmousedown={keepEditorFocus}
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
/* The dock owns the bottom edge: the home-indicator inset while the keyboard
 * is down, a plain gap while it is up and covers that area anyway. */
.mobile-composer-dock {
  gap: 0.25rem;
  padding-top: 0.25rem;
  padding-bottom: calc(0.375rem + var(--safe-bottom));
  --well: var(--well-on-panel);
}

.mobile-composer-dock:focus-within {
  padding-bottom: 0.375rem;
}

.mobile-composer-dock[data-tone="info"] {
  border-top-color: var(--info);
}

.mobile-composer-dock[data-tone="warning"] {
  border-top-color: var(--warning);
}

/* ComposerEditor draws a bordered field for standalone use; the dock is the
 * field here (rendered child component, escape-hatch reason 5). */
.editor-shell :global(.composer-editor),
.editor-shell :global(.composer-editor:focus-within) {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
</style>
