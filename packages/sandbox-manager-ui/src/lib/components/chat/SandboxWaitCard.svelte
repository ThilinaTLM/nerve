<script lang="ts">
  import { CheckCheck, MessageCircleQuestion, ShieldQuestion, X } from "@lucide/svelte";
  import type { SandboxWaitSummary } from "@nervekit/shared";
  import { Button } from "@nervekit/ui/components/ui/button";
  import { Input } from "@nervekit/ui/components/ui/input";

  let {
    wait,
    onsubmitInput,
    onresolveApproval,
  }: {
    wait: SandboxWaitSummary;
    onsubmitInput: (waitId: string, text: string) => void;
    onresolveApproval: (waitId: string, decision: "grant" | "deny") => void;
  } = $props();

  let answer = $state("");
</script>

<div class="rounded-md border border-warning/40 bg-warning/10 p-3">
  {#if wait.kind === "input"}
    <div class="flex items-center gap-2 text-sm font-medium">
      <MessageCircleQuestion class="size-4 text-warning" />
      Input requested
    </div>
    {#if wait.question?.text}
      <p class="mt-1 text-sm">{wait.question.text}</p>
    {/if}
    <div class="mt-2 flex items-center gap-2">
      <Input
        bind:value={answer}
        placeholder="Type your answer…"
        ariaLabel="Answer requested input"
        onkeydown={(event) => {
          if (event.key === "Enter" && answer.trim()) {
            onsubmitInput(wait.waitId, answer);
            answer = "";
          }
        }}
      />
      <Button
        size="sm"
        disabled={!answer.trim()}
        onclick={() => {
          onsubmitInput(wait.waitId, answer);
          answer = "";
        }}
      >
        Send
      </Button>
    </div>
  {:else}
    <div class="flex items-center gap-2 text-sm font-medium">
      <ShieldQuestion class="size-4 text-warning" />
      Approval required
    </div>
    {#if wait.reason}
      <p class="mt-1 text-sm">{wait.reason}</p>
    {/if}
    {#if wait.risks?.length}
      <p class="mt-1 text-xs text-muted-foreground">Risk: {wait.risks.join(", ")}</p>
    {/if}
    <div class="mt-2 flex items-center gap-2">
      <Button
        size="sm"
        variant="success"
        onclick={() => onresolveApproval(wait.waitId, "grant")}
      >
        <CheckCheck class="size-4" /> Approve
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onclick={() => onresolveApproval(wait.waitId, "deny")}
      >
        <X class="size-4" /> Deny
      </Button>
    </div>
  {/if}
</div>
