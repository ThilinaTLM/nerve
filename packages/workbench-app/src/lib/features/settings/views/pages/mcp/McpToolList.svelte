<!-- What the agent sees of a server: each tool with its description and input schema. -->
<script lang="ts">
import ChevronRight from "@lucide/svelte/icons/chevron-right";
import * as Collapsible from "@nervekit/ui-kit/components/ui/collapsible";

type Tool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

let { tools }: { tools: Tool[] } = $props();
</script>

<ul class="grid divide-y divide-border-subtle rounded-md border bg-card">
  {#each tools as tool (tool.name)}
    <li>
      <Collapsible.Root>
        <Collapsible.Trigger
          class="group flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-hover"
        >
          <ChevronRight
            class="mt-0.5 size-3.5 flex-none text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
            aria-hidden="true"
          />
          <span class="grid min-w-0 gap-0.5">
            <span class="font-mono text-ui text-foreground">{tool.name}</span>
            {#if tool.description}
              <span class="line-clamp-2 text-caption text-muted-foreground"
                >{tool.description}</span
              >
            {/if}
          </span>
        </Collapsible.Trigger>
        <Collapsible.Content class="grid gap-2 px-3 pb-3 pl-8">
          {#if tool.description}
            <p class="whitespace-pre-wrap text-ui text-foreground">
              {tool.description}
            </p>
          {/if}
          <pre
            class="max-h-60 overflow-auto rounded-md bg-well p-2 font-mono text-caption text-foreground">{JSON.stringify(
              tool.inputSchema,
              null,
              2,
            )}</pre>
        </Collapsible.Content>
      </Collapsible.Root>
    </li>
  {/each}
</ul>
