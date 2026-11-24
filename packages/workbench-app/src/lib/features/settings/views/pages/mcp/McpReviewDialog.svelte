<!--
  What an MCP server entry would run and what it sends out of the machine.
  Approve or reject binds to the exact entry shown; if it changed meanwhile the
  decision asks again.
-->
<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { McpReview } from "@nervekit/contracts/mcp";
import { Callout } from "@nervekit/ui-kit/components/composites/callout";
import DialogShell from "@nervekit/ui-kit/components/composites/dialog-shell";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import McpInlineCode from "./McpInlineCode.svelte";
import { Skeleton } from "@nervekit/ui-kit/components/ui/skeleton";

let {
  open = $bindable(false),
  name,
  review,
  loading = false,
  busy = false,
  error,
  onDecide,
}: {
  open?: boolean;
  name: string;
  /** Null: the entry is no longer there. */
  review?: McpReview | null;
  loading?: boolean;
  busy?: boolean;
  error?: string;
  onDecide: (status: "trusted" | "rejected") => void;
} = $props();

const grants = $derived(review?.grants);
const where = $derived(
  review?.scope === "project" ? "this project" : "your settings",
);
</script>

<DialogShell
  bind:open
  size="md"
  title={`Review ${name}`}
  description={review
    ? `Defined in ${where}. It does not run until you approve it, and any change to the entry asks again.`
    : undefined}
>
  {#if loading}
    <Skeleton class="h-24 w-full" />
  {:else if review === null}
    <Callout
      layout="block"
      tone="neutral"
      text="This entry is no longer there."
    />
  {:else if review && grants}
    <div class="grid gap-4">
      <section class="grid gap-1.5">
        <GroupLabel
          label={grants.transport === "http" ? "Connects to" : "Runs"}
        />
        <p
          class="break-all rounded-md bg-well p-2 font-mono text-ui text-foreground"
        >
          {grants.url ?? [grants.command, ...(grants.args ?? [])].join(" ")}
        </p>
        {#if grants.cwd}
          <p class="text-caption text-muted-foreground">
            In <span class="font-mono">{grants.cwd}</span>
          </p>
        {/if}
      </section>
      {#if grants.env?.length || grants.headers?.length}
        <section class="grid gap-1.5">
          <GroupLabel
            label={grants.transport === "http" ? "Headers" : "Environment"}
          />
          <ul class="grid gap-1 font-mono text-ui">
            {#each grants.env ?? [] as variable (variable.name)}
              <li class="flex items-start gap-2 break-all">
                {#if variable.changesExecution}
                  <TriangleAlert
                    class="mt-0.5 size-3.5 flex-none text-warning"
                    aria-label="Changes what runs"
                  />
                {/if}
                <span class="text-foreground"
                  >{variable.name}={variable.value}</span
                >
              </li>
            {/each}
            {#each grants.headers ?? [] as header (header.name)}
              <li class="break-all text-foreground">
                {header.name}: {header.value}
              </li>
            {/each}
          </ul>
        </section>
      {/if}
      {#if review.notes?.length}
        <section class="grid gap-1.5">
          <GroupLabel label="Notes" />
          <ul class="grid gap-1 text-ui text-muted-foreground">
            {#each review.notes as note (note)}
              <li><McpInlineCode text={note} /></li>
            {/each}
          </ul>
        </section>
      {/if}
      <section class="grid gap-1.5">
        <GroupLabel label="Can leave this computer" />
        {#if review.sends.length}
          <ul class="grid gap-1.5 text-ui">
            {#each review.sends as sentence (sentence)}
              <li class="flex items-start gap-2">
                <TriangleAlert
                  class="mt-0.5 size-3.5 flex-none text-warning"
                  aria-hidden="true"
                />
                <span class="text-foreground"
                  ><McpInlineCode text={sentence} /></span
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-ui text-muted-foreground">
            No variables or secrets are sent.
          </p>
        {/if}
      </section>
    </div>
  {/if}
  {#if error}<Callout tone="destructive" text={error} />{/if}
  {#snippet footer()}
    <Button variant="outline" onclick={() => (open = false)}>Not now</Button>
    {#if review}
      <Button
        variant="outline"
        disabled={busy || review.status === "rejected"}
        onclick={() => onDecide("rejected")}>Reject</Button
      >
      <Button disabled={busy} onclick={() => onDecide("trusted")}
        >Approve</Button
      >
    {/if}
  {/snippet}
</DialogShell>
