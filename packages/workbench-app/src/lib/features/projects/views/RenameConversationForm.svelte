<script lang="ts">
import { onMount, untrack } from "svelte";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  conversationTitleToPlainText,
} from "@nervekit/contracts/core";
import { Textarea } from "@nervekit/ui-kit/components/ui/textarea";

/** Title editor shared by the rename popover and dialog. Titles are a single
 * line, so Enter saves and line breaks become spaces; the field still wraps
 * because titles are often a sentence or two. */
let {
  title,
  id,
  value = $bindable(""),
  canSave = $bindable(false),
  autofocus = true,
  onSubmit,
}: {
  /** Stored title; image markers are shown as plain text. */
  title: string;
  id?: string;
  /** The trimmed title, ready to save. */
  value?: string;
  canSave?: boolean;
  autofocus?: boolean;
  onSubmit: () => void;
} = $props();

const initial = untrack(() => conversationTitleToPlainText(title));
let draft = $state(initial);
let textarea = $state<HTMLTextAreaElement | null>(null);

$effect(() => {
  value = draft.replace(/\s*[\r\n]+\s*/gu, " ").trim();
  canSave = value.length > 0 && value !== initial;
});

onMount(() => {
  if (!autofocus) return;
  // After the surrounding popover or dialog has taken focus.
  const frame = requestAnimationFrame(() => {
    textarea?.focus();
    textarea?.select();
  });
  return () => cancelAnimationFrame(frame);
});
</script>

<Textarea
  bind:ref={textarea}
  bind:value={draft}
  {id}
  {autofocus}
  rows={2}
  maxlength={CONVERSATION_TITLE_MAX_LENGTH}
  aria-label="Conversation title"
  class="max-h-40 resize-none"
  onkeydown={(event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (canSave) onSubmit();
    }
  }}
/>
