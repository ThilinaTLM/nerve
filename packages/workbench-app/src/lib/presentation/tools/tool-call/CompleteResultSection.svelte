<script lang="ts">
import type {
  CompleteToolResultDescriptor,
  ToolCallResultChunk,
} from "$lib/presentation/view-models/conversation";
import { untrack } from "svelte";
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
  wrap?: boolean;
  /** Text loaded so far, for the pane's copy action. */
  onTextChange?: (text: string) => void;
};
let {
  toolCallId,
  descriptor,
  read,
  wrap = true,
  onTextChange,
}: Props = $props();

const CHUNK_BYTES = 64 * 1024;
const SMALL_RESULT_BYTES = 256 * 1024;
let loading = $state(false);
let text = $state("");
let nextByteOffset = $state(0);
let done = $state(false);
let status = $state(untrack(() => descriptor.status));
let error = $state<string | undefined>(undefined);
let requestGeneration = 0;

// The pane mounts this section the first time its tab is opened, so loading
// starts as soon as the descriptor is known and restarts when it changes.
$effect(() => {
  void toolCallId;
  void descriptor.digest;
  const hasResult = descriptor.hasResult;
  const nextStatus = descriptor.status;
  untrack(() => {
    requestGeneration += 1;
    loading = false;
    text = "";
    nextByteOffset = 0;
    done = !hasResult;
    status = nextStatus;
    error = undefined;
    void loadInitial();
  });
});

$effect(() => {
  onTextChange?.(text);
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

<div class="grid gap-2 p-3">
  {#if !descriptor.hasResult}
    <p class="m-0 text-ui text-muted-foreground">
      This tool call has no result.
    </p>
  {:else if notice}
    <p class="m-0 text-ui text-warning">{notice}</p>
  {:else if !read}
    <p class="m-0 text-ui text-muted-foreground">
      Complete result loading is unavailable here.
    </p>
  {:else if error}
    <p class="m-0 text-ui text-destructive">{error}</p>
    <Button variant="outline" class="w-fit" onclick={() => void loadInitial()}
      >Retry</Button
    >
  {:else if done && text.length === 0}
    <p class="m-0 text-ui text-muted-foreground">
      The complete result is empty.
    </p>
  {:else if text.length > 0}
    {#if large}
      <!-- A virtual list needs its own bounded viewport. -->
      <LargeResultViewer {text} {wrap} maxHeight="min(32rem, 55vh)" />
    {:else}
      <ResultCodeBlock
        bare
        code={text}
        language="json"
        {wrap}
        maxHeight="none"
        trim={false}
      />
    {/if}
    {#if !done}
      <div class="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={loading}
          onclick={() => void loadOne(requestGeneration)}
        >
          {loading ? "Loading…" : "Load next chunk"}
        </Button>
        <Button
          variant="ghost"
          disabled={loading}
          onclick={() => void loadAll()}>Load all</Button
        >
        <span class="text-ui text-muted-foreground">
          {nextByteOffset.toLocaleString()} of {descriptor.byteLength.toLocaleString()}
          bytes loaded
        </span>
      </div>
    {/if}
  {:else if loading}
    <p class="m-0 text-ui text-muted-foreground">Loading complete result…</p>
  {/if}
</div>
