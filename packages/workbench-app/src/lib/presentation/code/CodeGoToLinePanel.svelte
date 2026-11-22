<script lang="ts">
import CornerDownLeft from "@lucide/svelte/icons/corner-down-left";
import {
  FloatingPanel,
  FloatingToolbarButton,
  FloatingToolbarText,
} from "@nervekit/ui-kit/components/composites/floating-toolbar";
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

<FloatingPanel label="Go to line" size="sm">
  <form class="grid gap-1" onsubmit={submit}>
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
      <FloatingToolbarButton
        type="submit"
        label="Go to line"
        icon={CornerDownLeft}
        shortcut="Enter"
        disabled={!target}
        onmousedown={(event: MouseEvent) => event.preventDefault()}
      />
    </div>
    <FloatingToolbarText tone={invalid ? "destructive" : "muted"} live>
      {invalid
        ? "Enter a line number, or line:column"
        : `Line ${firstLine}–${lastLine}, or line:column`}
    </FloatingToolbarText>
  </form>
</FloatingPanel>
