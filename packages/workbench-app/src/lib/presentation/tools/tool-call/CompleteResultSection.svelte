<script lang="ts">
import type {
  CompleteToolResultDescriptor,
  ToolCallResultChunk,
} from "@nervekit/contracts/tools";
import { Button } from "@nervekit/ui-kit/components/ui/button";
import ResultCodeBlock from "./ResultCodeBlock.svelte";
import LargeResultViewer from "./LargeResultViewer.svelte";

type Props = {
  toolCallId: string;
  descriptor: CompleteToolResultDescriptor;
  read?: (
    toolCallId: string,
    byteOffset: number,
    byteLimit?: number,
  ) => Promise<ToolCallResultChunk>;
};
let { toolCallId, descriptor, read }: Props = $props();

const CHUNK_BYTES = 64 * 1024;
const SMALL_RESULT_BYTES = 256 * 1024;
let activated = $state(false);
let loading = $state(false);
let text = $state("");
let nextByteOffset = $state(0);
let done = $state(false);
let status = $state(descriptor.status);
let error = $state<string | undefined>(undefined);
let requestGeneration = 0;

$effect(() => {
  void toolCallId;
  void descriptor.digest;
  requestGeneration += 1;
  activated = false;
  loading = false;
  text = "";
  nextByteOffset = 0;
  done = !descriptor.hasResult;
  status = descriptor.status;
  error = undefined;
});

async function loadOne(generation: number): Promise<boolean> {
  if (
    !read ||
    done ||
    loading ||
    status === "unavailable" ||
    status === "corrupt"
  )
    return false;
  loading = true;
  error = undefined;
  try {
    const chunk = await read(toolCallId, nextByteOffset, CHUNK_BYTES);
    if (generation !== requestGeneration) return false;
    status = chunk.status;
    if (chunk.status === "unavailable" || chunk.status === "corrupt") {
      text = "";
      done = true;
      return false;
    }
    text += chunk.text;
    nextByteOffset = chunk.nextByteOffset;
    done = chunk.done;
    return true;
  } catch (caught) {
    if (generation === requestGeneration) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return false;
  } finally {
    if (generation === requestGeneration) loading = false;
  }
}

async function loadInitial(): Promise<void> {
  const generation = requestGeneration;
  do {
    const loaded = await loadOne(generation);
    if (!loaded || generation !== requestGeneration) return;
  } while (!done && descriptor.byteLength <= SMALL_RESULT_BYTES);
}

async function loadAll(): Promise<void> {
  if (
    descriptor.byteLength > 4 * 1024 * 1024 &&
    !window.confirm(
      `Load the complete ${Math.ceil(descriptor.byteLength / 1024 / 1024)} MB result?`,
    )
  )
    return;
  const generation = requestGeneration;
  while (!done && generation === requestGeneration) {
    if (!(await loadOne(generation))) return;
  }
}

const notice = $derived(
  status === "unavailable"
    ? "The complete result payload is unavailable."
    : status === "corrupt"
      ? "The complete result payload failed verification and was not displayed."
      : status === "legacy_bounded"
        ? "Only the bounded legacy result is available."
        : undefined,
);
const large = $derived(descriptor.byteLength > SMALL_RESULT_BYTES);
</script>

<details
  class="rounded-sm border bg-muted/20"
  ontoggle={(event) => {
    if (event.currentTarget.open && !activated) {
      activated = true;
      void loadInitial();
    }
  }}
>
  <summary
    class="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground"
  >
    Complete result
    <span class="font-normal"
      >· {descriptor.byteLength.toLocaleString()} bytes</span
    >
  </summary>
  <div class="grid gap-2 border-t p-2">
    {#if !descriptor.hasResult}
      <p class="m-0 text-sm text-muted-foreground">
        This tool call has no result.
      </p>
    {:else if notice}
      <p class="m-0 text-sm text-warning">{notice}</p>
    {:else if !read}
      <p class="m-0 text-sm text-muted-foreground">
        Complete result loading is unavailable here.
      </p>
    {:else if error}
      <p class="m-0 text-sm text-destructive">{error}</p>
      <Button
        size="sm"
        variant="outline"
        class="w-fit"
        onclick={() => void loadInitial()}>Retry</Button
      >
    {:else if activated && done && text.length === 0}
      <p class="m-0 text-sm text-muted-foreground">
        The complete result is empty.
      </p>
    {:else if activated && text.length > 0}
      {#if large}
        <LargeResultViewer {text} />
      {:else}
        <ResultCodeBlock
          code={text}
          language="json"
          maxHeight="22rem"
          trim={false}
        />
      {/if}
      {#if !done}
        <div class="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onclick={() => void loadOne(requestGeneration)}
          >
            {loading ? "Loading…" : "Load next chunk"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={loading}
            onclick={() => void loadAll()}>Load all</Button
          >
          <span class="text-xs text-muted-foreground">
            {nextByteOffset.toLocaleString()} of {descriptor.byteLength.toLocaleString()}
            bytes loaded
          </span>
        </div>
      {/if}
    {:else if loading}
      <p class="m-0 text-sm text-muted-foreground">Loading complete result…</p>
    {/if}
  </div>
</details>
