<!--
  What an MCP server entry waiting for review runs and what it sends out of the
  machine: what the user approves. The decision binds to the exact entry shown.
-->
<script lang="ts">
import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
import type { McpReview } from "@nervekit/contracts/mcp";
import { GroupLabel } from "@nervekit/ui-kit/components/composites/group-label";
import { SettingsSection } from "$lib/presentation/settings";
import McpInlineCode from "./McpInlineCode.svelte";

let { review }: { review: McpReview } = $props();

const grants = $derived(review.grants);
</script>

<SettingsSection title={grants.transport === "http" ? "Connects to" : "Runs"}>
  <div class="grid gap-4">
    <section class="grid gap-1.5">
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
  </div>
</SettingsSection>

<SettingsSection title="Can leave this computer">
  {#if review.sends.length}
    <ul class="grid gap-1.5 text-ui">
      {#each review.sends as sentence (sentence)}
        <li class="flex items-start gap-2">
          <TriangleAlert
            class="mt-0.5 size-3.5 flex-none text-warning"
            aria-hidden="true"
          />
          <span class="text-foreground"><McpInlineCode text={sentence} /></span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="text-ui text-muted-foreground">
      No variables or secrets are sent.
    </p>
  {/if}
</SettingsSection>
