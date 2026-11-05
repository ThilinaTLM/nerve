<script lang="ts">
import type { Snippet } from "svelte";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import Dialog from "@nervekit/ui-kit/components/composites/dialog-shell";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";
import { cn } from "@nervekit/ui-kit/utils";

type Props = {
  open?: boolean;
  title: string;
  description?: string;
  size?: "sm" | "md" | "default" | "wide";
  submitLabel: string;
  /** Validation gate; separate from `busy`. */
  submitDisabled?: boolean;
  /** Disables both buttons and shows a spinner on the primary action. */
  busy?: boolean;
  /** Primary action tone; `destructive` for irreversible confirmations. */
  submitVariant?: "default" | "destructive";
  error?: string;
  errorClass?: string;
  bodyClass?: string;
  bodyTourId?: string;
  submitTourId?: string;
  closeOnInteractOutside?: boolean;
  onSubmit: () => void | Promise<void>;
  /** Default: closes the dialog. */
  onCancel?: () => void;
  onOpenChange?: (open: boolean) => void;
  children: Snippet;
  /** Leading footer slot, e.g. a destructive secondary action. */
  footerLeading?: Snippet;
};

let {
  open = $bindable(false),
  title,
  description,
  size = "sm",
  submitLabel,
  submitDisabled = false,
  busy = false,
  submitVariant = "default",
  error,
  errorClass,
  bodyClass,
  bodyTourId,
  submitTourId,
  closeOnInteractOutside = true,
  onSubmit,
  onCancel,
  onOpenChange,
  children,
  footerLeading,
}: Props = $props();

const formId = $props.id();

function handleSubmit(event: SubmitEvent) {
  event.preventDefault();
  if (busy || submitDisabled) return;
  void onSubmit();
}

/**
 * Enter in a field would implicitly submit. Destructive confirmations require
 * an explicit click/Enter on the button itself, so fields never trigger them.
 */
function handleKeydown(event: KeyboardEvent) {
  if (
    submitVariant === "destructive" &&
    event.key === "Enter" &&
    event.target instanceof HTMLInputElement
  )
    event.preventDefault();
}

function cancel() {
  if (onCancel) onCancel();
  else {
    open = false;
    onOpenChange?.(false);
  }
}
</script>

<Dialog
  bind:open
  {title}
  {description}
  {size}
  {closeOnInteractOutside}
  {onOpenChange}
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <form
    id={formId}
    class={cn("grid gap-3", bodyClass)}
    data-tour-id={bodyTourId}
    onsubmit={handleSubmit}
    onkeydown={handleKeydown}
  >
    {@render children()}
    {#if error}
      <p class={cn("text-ui text-destructive", errorClass)} role="alert">
        {error}
      </p>
    {/if}
  </form>
  {#snippet footer()}
    {#if footerLeading}
      <div class="mr-auto flex items-center gap-2">
        {@render footerLeading()}
      </div>
    {/if}
    <Button type="button" variant="ghost" disabled={busy} onclick={cancel}
      >Cancel</Button
    >
    <Button
      type="submit"
      form={formId}
      variant={submitVariant}
      disabled={busy || submitDisabled}
      data-tour-id={submitTourId}
    >
      {#if busy}<Spinner class="size-3.5" />{/if}
      {submitLabel}
    </Button>
  {/snippet}
</Dialog>
