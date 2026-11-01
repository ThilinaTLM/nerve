<script lang="ts">
import { untrack } from "svelte";
import ResultCodeBlock from "./ResultCodeBlock.svelte";

type Props = { value: unknown; open?: boolean };
let { value, open = false }: Props = $props();
let activated = $state(untrack(() => open));

function serialize(value: unknown): { text: string; language?: string } {
  if (typeof value === "string") return { text: value };
  try {
    return {
      text: JSON.stringify(value, null, 2) ?? String(value),
      language: "json",
    };
  } catch {
    return { text: String(value) };
  }
}

const content = $derived(activated ? serialize(value) : undefined);
</script>

<details
  {open}
  ontoggle={(event) => {
    if (event.currentTarget.open) activated = true;
  }}
>
  <summary
    class="cursor-pointer px-2.5 py-2 text-ui font-medium text-muted-foreground"
  >
    Arguments
  </summary>
  {#if activated && content}
    <div class="px-2.5 pb-2.5">
      <ResultCodeBlock
        bare
        code={content.text}
        language={content.language}
        maxHeight="22rem"
        trim={false}
        highlight={content.text.length <= 256 * 1024}
      />
    </div>
  {/if}
</details>
