<script lang="ts">
import Terminal from "@lucide/svelte/icons/terminal";
import { Spinner } from "@nervekit/ui-kit/components/ui/spinner";

type Props = {
  command: string;
  /**
   * running: preparing/executing this command; done: settled (including
   * interrupted commands); static: not started or historical raw block.
   */
  phase: "running" | "done" | "static";
  status?: string;
  exitCode?: number;
  output?: string;
};

let { command, phase, status, exitCode, output = "" }: Props = $props();

const ok = $derived(
  exitCode === 0 || (exitCode === undefined && status === "completed"),
);
const resultLabel = $derived(
  exitCode !== undefined ? `exit ${exitCode}` : (status ?? ""),
);
</script>

<div
  class="w-full min-w-0 overflow-hidden rounded-md border border-border bg-card text-card-foreground"
>
  <div class="flex items-start gap-2 px-2.5 py-1.5">
    <Terminal
      size={14}
      strokeWidth={2}
      class="mt-0.5 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
    <pre
      class="min-w-0 flex-1 font-mono text-ui leading-5 whitespace-pre-wrap break-words"><span
        class="inline-flex size-3.5 items-center justify-center align-middle"
        >{#if phase === "running"}<Spinner
            class="size-full motion-reduce:animate-none!"
            aria-label="Preparing command"
          />{:else}<span aria-hidden="true">$</span>{/if}</span
      > {command}</pre>
    {#if phase === "done" && resultLabel}
      <span
        class={`shrink-0 font-mono text-ui leading-5 ${ok ? "text-success" : "text-destructive"}`}
        title={status ? `status: ${status}` : undefined}
      >
        {resultLabel}
      </span>
    {/if}
  </div>
  {#if phase === "done"}
    <div class="border-t border-border px-2.5 py-1.5">
      {#if output}
        <pre
          class="min-w-0 font-mono text-ui leading-4 whitespace-pre-wrap break-words text-muted-foreground">{output}</pre>
      {:else}
        <p class="font-mono text-ui italic text-muted-foreground">
          (no output)
        </p>
      {/if}
    </div>
  {/if}
</div>
