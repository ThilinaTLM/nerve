<script lang="ts">
import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import { Input } from "@nervekit/ui-kit/components/ui/input";
import { tick } from "svelte";
import { parseGoToLine, type GoToLineTarget } from "./code-viewer-helpers";

let {
  currentLine,
  firstLine,
  lastLine,
  onGo,
  onClose,
}: {
  currentLine: number;
  firstLine: number;
  lastLine: number;
  onGo: (target: GoToLineTarget) => void;
  onClose: () => void;
} = $props();

let value = $state("");
let input: HTMLInputElement | null = $state(null);
const target = $derived(parseGoToLine(value));
const invalid = $derived(value.trim() !== "" && !target);

$effect(() => {
  void tick().then(() => input?.focus());
});

function submit(event: SubmitEvent) {
  event.preventDefault();
  if (target) onGo(target);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  onClose();
}
</script>

<form
  class="floating-surface absolute top-2 right-3 left-3 z-10 grid gap-1 p-1 sm:left-auto sm:w-80"
  aria-label="Go to line"
  onsubmit={submit}
>
  <div class="flex items-center gap-1">
    <Input
      bind:ref={input}
      bind:value
      class="min-w-0 flex-1 font-mono placeholder:font-sans"
      inputmode="numeric"
      autocomplete="off"
      spellcheck={false}
      aria-invalid={invalid}
      ariaLabel={`Go to line, ${firstLine} to ${lastLine}`}
      placeholder={`${currentLine}`}
      onkeydown={handleKeydown}
      onblur={onClose}
    />
    <Button
      type="submit"
      variant="ghost"
      size="icon-sm"
      ariaLabel="Go to line"
      title="Go (Enter)"
      disabled={!target}
      onmousedown={(event: MouseEvent) => event.preventDefault()}
    >
      <CornerDownLeft class="size-3.5" />
    </Button>
  </div>
  <p
    class={`m-0 px-1 text-ui ${invalid ? "text-destructive" : "text-muted-foreground"}`}
    aria-live="polite"
  >
    {invalid
      ? "Enter a line number, or line:column"
      : `Line ${firstLine}–${lastLine}, or line:column`}
  </p>
</form>
